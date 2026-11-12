import { ArrowRightLeftIcon } from "lucide-react";
import type {
  EnvironmentId,
  OrchestrationV2ThreadHandoff,
  OrchestrationV2ImportOrigin,
  OrchestrationV2LinkOrigin,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { incomingMoveRecoveryCommand } from "@t3tools/client-runtime/state/threadHandoff";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useNavigate } from "@tanstack/react-router";
import { buildThreadRouteParams } from "../../threadRoutes";
import { openThreadMove } from "./threadMoveDialogState";
import { threadHandoffEnvironment } from "../../state/threadHandoff";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function useThreadMoveBanner(
  thread: {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly handoff?: OrchestrationV2ThreadHandoff;
    readonly importOrigin?: OrchestrationV2ImportOrigin;
    readonly linkOrigin?: OrchestrationV2LinkOrigin | null | undefined;
  } | null,
): ComposerBannerStackItem | null {
  const retry = useAtomCommand(threadHandoffEnvironment.retry);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "incoming file recovery command",
  });
  const navigate = useNavigate();
  const { presentationById } = useEnvironments();
  const move = thread?.handoff;
  if (!thread) return null;
  if (!move && thread.importOrigin) {
    const origin = thread.importOrigin;
    const recovery = incomingMoveRecoveryCommand(origin);
    return {
      id: `thread-move-origin:${thread.id}`,
      group: "environment",
      variant: "info",
      icon: <ArrowRightLeftIcon />,
      title: `Moved from ${thread.linkOrigin?.label ?? "another machine"}`,
      description: recovery
        ? "Recent conversation text and Git files arrived in a disposable worktree. Its original incoming files are retained for recovery. Stop external writers before moving again."
        : "Recent conversation text and Git files arrived in a new worktree. Earlier history and local-only resources remain on the source.",
      actions: (
        <>
          {recovery ? (
            <Button size="xs" variant="ghost" onClick={() => copyToClipboard(recovery, undefined)}>
              {isCopied ? "Copied recovery command" : "Copy recovery command"}
            </Button>
          ) : null}
          {presentationById.get(origin.environmentId)?.connection.phase === "connected" ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(
                    scopeThreadRef(origin.environmentId, origin.threadId),
                  ),
                })
              }
            >
              Source history
            </Button>
          ) : null}
        </>
      ),
    };
  }
  if (!move) return null;
  return {
    id: `thread-move:${thread.id}`,
    group: move.state === "failed" ? "attention" : "environment",
    variant: move.state === "failed" ? "error" : move.state === "departing" ? "warning" : "info",
    icon: <ArrowRightLeftIcon />,
    title:
      move.state === "departed"
        ? `Moved to ${move.label}`
        : move.state === "failed"
          ? `Couldn’t move to ${move.label}`
          : `Moving to ${move.label}`,
    description:
      move.state === "failed"
        ? move.lastError
        : move.state === "departing"
          ? (move.lastError ?? "Messages are paused until the destination confirms the move.")
          : `This copy is read only. ${move.retirement?.reason ?? "Its source files were kept. Continue on the other machine."}`,
    actions:
      move.state === "departed" ? (
        <>
          {incomingMoveRecoveryCommand(thread.importOrigin) ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                copyToClipboard(incomingMoveRecoveryCommand(thread.importOrigin)!, undefined)
              }
            >
              {isCopied ? "Copied recovery command" : "Copy recovery command"}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void (presentationById.get(move.environmentId)?.connection.phase === "connected"
                ? navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(move.environmentId, move.threadId),
                    ),
                  })
                : navigate({ to: "/settings/connections" }))
            }
          >
            {presentationById.get(move.environmentId)?.connection.phase === "connected"
              ? "Open chat"
              : "Connect to open"}
          </Button>
        </>
      ) : move.state === "departing" ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void retry({ environmentId: thread.environmentId, input: { threadId: thread.id } })
          }
        >
          Check again
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => openThreadMove(scopeThreadRef(thread.environmentId, thread.id))}
        >
          Try again
        </Button>
      ),
  };
}
