import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRightLeftIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { closeThreadMove, useThreadMoveDialogState } from "./threadMoveDialogState";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { threadHandoffEnvironment } from "../../state/threadHandoff";
import { useAtomCommand } from "../../state/use-atom-command";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { buildThreadRouteParams, isThreadRoutePathname } from "../../threadRoutes";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogPopup,
  DialogFooter,
} from "../ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "../ui/alert";

export function ThreadMoveDialogHost() {
  const source = useThreadMoveDialogState((state) => state.source);
  const session = useThreadMoveDialogState((state) => state.session);
  return source ? <MoveDialog key={session} source={source} /> : null;
}

function MoveDialog({ source }: { readonly source: ScopedThreadRef }) {
  const labelId = useId();
  const thread = useQuietThreadShell(source);
  const query = useEnvironmentQuery(
    threadHandoffEnvironment.options({
      environmentId: source.environmentId,
      input: { threadId: source.threadId },
    }),
  );
  const canStart = useAtomValue(
    threadHandoffEnvironment.start.permissionAtom(source.environmentId),
  );
  const start = useAtomCommand(threadHandoffEnvironment.start, { reportFailure: false });
  const [pickedMachine, setPickedMachine] = useState<EnvironmentId | null>(null);
  const [pickedProject, setPickedProject] = useState<ProjectId | null>(null);
  const [capturedDraft] = useState(() => useComposerDraftStore.getState().getComposerDraft(source));
  const capturedPrompt = capturedDraft?.prompt ?? "";
  const initialInstruction = capturedPrompt.trim() === "/move" ? "" : capturedPrompt;
  const [instruction, setInstruction] = useState(initialInstruction);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const navigatedAway = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { presentationById } = useEnvironments();
  const options = query.data?.options ?? [];
  const eligible = options.filter((option) => option.reason === null);
  const selectedId = pickedMachine ?? (eligible.length === 1 ? eligible[0]!.environmentId : null);
  const target = options.find((option) => option.environmentId === selectedId);
  const projectId = pickedProject ?? target?.projectId ?? null;
  const draftHasContext = capturedDraft
    ? composerDraftHasUserContent({ ...capturedDraft, prompt: "" })
    : false;
  const busy = thread?.latestRun
    ? ["queued", "preparing", "starting", "running", "waiting"].includes(thread.latestRun.status)
    : false;
  const blocked = !thread
    ? "This chat is no longer available."
    : thread.handoff && thread.handoff.state !== "failed"
      ? "This chat already has a move. Its status is shown beside the composer."
      : busy
        ? "Stop this turn or wait for it to finish before moving."
        : draftHasContext
          ? "This draft has attachments or other context. Resolve those in the composer before moving."
          : !canStart
            ? "You do not have permission to move this chat."
            : (target?.reason ?? null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows a durable server move only for the initiating view, without overriding later navigation or drafts
  useEffect(() => {
    if (!submitted) return;
    if (!isThreadRoutePathname(location.pathname, source)) navigatedAway.current = true;
    const moved = thread?.handoff;
    if (moved?.state !== "departed") return;
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(source);
    const unchanged =
      (draft?.prompt ?? "") === capturedPrompt &&
      (!draft || !composerDraftHasUserContent({ ...draft, prompt: "" }));
    if (
      unchanged &&
      ((capturedPrompt.trim() === "/move" && instruction.trim() === "") ||
        (instruction.trim() !== "" && instruction === initialInstruction))
    )
      store.setPrompt(source, "");
    closeThreadMove();
    if (
      !navigatedAway.current &&
      unchanged &&
      presentationById.get(moved.environmentId)?.connection.phase === "connected"
    )
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(moved.environmentId, moved.threadId)),
      });
  }, [
    submitted,
    thread?.handoff,
    location.pathname,
    source,
    capturedPrompt,
    instruction,
    initialInstruction,
    navigate,
    presentationById,
  ]);

  const submit = async () => {
    if (submitLock.current || !target || !projectId || blocked) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    const result = await start({
      environmentId: source.environmentId,
      input: {
        threadId: source.threadId,
        environmentId: target.environmentId,
        projectId,
        ...(instruction.trim() ? { continuationPrompt: instruction.trim() } : {}),
      },
    });
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      submitLock.current = false;
      setSubmitting(false);
      return;
    }
    if (result.value.state === "failed") {
      setError(result.value.lastError);
      submitLock.current = false;
      setSubmitting(false);
      return;
    }
    setSubmitted(true);
  };
  if (submitted) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeThreadMove();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Move chat</DialogTitle>
            <DialogDescription>Continue this conversation on another machine.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {query.isPending ? (
                <p role="status">Checking available machines…</p>
              ) : options.length === 0 ? (
                <p>No linked machines. Link a machine in Settings → Connections first.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label id={labelId}>Machine</Label>
                  <Select
                    items={options.map((option) => ({
                      value: option.environmentId,
                      label: option.label,
                    }))}
                    value={selectedId}
                    onValueChange={(value) => {
                      setPickedMachine(value as EnvironmentId);
                      setPickedProject(null);
                    }}
                  >
                    <SelectTrigger aria-labelledby={labelId}>
                      <SelectValue placeholder="Choose a machine" />
                    </SelectTrigger>
                    <SelectPopup>
                      {options.map((option) => (
                        <SelectItem key={option.environmentId} value={option.environmentId}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              )}
              {!query.isPending && (options.length === 0 || target?.reason) ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      closeThreadMove();
                      void navigate({ to: "/settings/connections" });
                    }}
                  >
                    Connections
                  </Button>
                  <Button type="button" variant="ghost" onClick={query.refresh}>
                    Refresh
                  </Button>
                </div>
              ) : null}
              {target && target.projects.length > 1 ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${labelId}-project`}>Project</Label>
                  <Select
                    items={target.projects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    }))}
                    value={projectId}
                    onValueChange={(value) => setPickedProject(value as ProjectId)}
                  >
                    <SelectTrigger id={`${labelId}-project`}>
                      <SelectValue placeholder="Choose a project" />
                    </SelectTrigger>
                    <SelectPopup>
                      {target.projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : target?.projects[0] ? (
                <p className="text-sm text-muted-foreground">Project: {target.projects[0].title}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Moves recent conversation text and captured Git working files. Earlier history stays
                here. Ignored untracked files, attachments, staging and running processes stay here.
                Uses the destination’s worktree setup. New move worktrees are disposable: after a
                later move, safely captured checkouts are removed immediately. Stop external
                writers; sources with local-only work are kept with a reason.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${labelId}-instruction`}>
                  Next instruction <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id={`${labelId}-instruction`}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="Run the Linux tests and fix any failures"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
              </div>
              {blocked || query.error || error ? (
                <Alert variant="warning">
                  <AlertTitle>Before moving</AlertTitle>
                  <AlertDescription>{error ?? query.error ?? blocked}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeThreadMove}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!target || !projectId || blocked !== null || submitting}
            >
              <ArrowRightLeftIcon />
              {instruction.trim() ? "Move and send" : "Move chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
