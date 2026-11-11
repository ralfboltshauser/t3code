import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { incomingMoveRecoveryCommand } from "@t3tools/client-runtime/state/threadHandoff";
import * as Clipboard from "expo-clipboard";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ListSection } from "../../components/ui/ListSection";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { Notice } from "../../components/ui/Notice";
import { useEnvironmentQuery } from "../../state/query";
import { useQuietThreadShell } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { environmentPresentations } from "../../state/presentation";
import { threadHandoffEnvironment } from "../../state/threadHandoff";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";

export function ThreadMoveScreen({
  route,
}: StaticScreenProps<{ environmentId: EnvironmentId; threadId: ThreadId; draftKey: string }>) {
  const { environmentId, threadId, draftKey } = route.params;
  const navigation = useNavigation();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const query = useEnvironmentQuery(
    threadHandoffEnvironment.options({ environmentId, input: { threadId } }),
  );
  const canStart = useAtomValue(threadHandoffEnvironment.start.permissionAtom(environmentId));
  const start = useAtomCommand(threadHandoffEnvironment.start, { reportFailure: false });
  const [draft] = useState(() => getComposerDraftSnapshot(draftKey));
  const initial = draft.text.trim() === "/move" ? "" : draft.text;
  const [instruction, setInstruction] = useState(initial);
  const [machine, setMachine] = useState<EnvironmentId | null>(null);
  const [project, setProject] = useState<ProjectId | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const options = query.data?.options ?? [];
  const available = options.filter((option) => option.reason === null);
  const target = options.find(
    (option) =>
      option.environmentId ===
      (machine ?? (available.length === 1 ? available[0]!.environmentId : null)),
  );
  const projectId = project ?? target?.projectId;
  const blocked = !canStart
    ? "You do not have permission to move this chat."
    : !thread
      ? "This chat is no longer available."
      : thread.handoff && thread.handoff.state !== "failed"
        ? "This chat already has a move. Check its status in the conversation."
        : draft.attachments.length > 0 || (draft.context?.records.length ?? 0) > 0
          ? "Resolve attachments and other draft context before moving."
          : target?.reason;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the acknowledged move only while its initiating route is focused
  useEffect(() => {
    if (!submitted || !navigation.isFocused() || thread?.handoff?.state !== "departed") return;
    const current = getComposerDraftSnapshot(draftKey);
    if (
      current.text !== draft.text ||
      current.attachments.length > 0 ||
      (current.context?.records.length ?? 0) > 0
    )
      return;
    if (presentations.get(thread.handoff.environmentId)?.connection.phase !== "connected") return;
    if (
      (draft.text.trim() === "/move" && !instruction.trim()) ||
      (instruction.trim() && instruction === initial)
    )
      setComposerDraftText(draftKey, "");
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(thread.handoff.environmentId),
        threadId: String(thread.handoff.threadId),
      }),
    );
  }, [
    submitted,
    navigation,
    thread?.handoff,
    draftKey,
    draft.text,
    instruction,
    initial,
    presentations,
  ]);
  const submit = async () => {
    if (locked.current || blocked || !target || !projectId) return;
    locked.current = true;
    setPending(true);
    setError(null);
    const result = await start({
      environmentId,
      input: {
        threadId,
        environmentId: target.environmentId,
        projectId,
        ...(instruction.trim() ? { continuationPrompt: instruction.trim() } : {}),
      },
    });
    if (result._tag === "Failure" || result.value.state === "failed") {
      setError(
        result._tag === "Failure"
          ? String(squashAtomCommandFailure(result))
          : result.value.state === "failed"
            ? result.value.lastError
            : "Could not move this chat.",
      );
      locked.current = false;
      setPending(false);
      return;
    }
    setSubmitted(true);
  };
  if (submitted)
    return (
      <View className="flex-1 bg-sheet-solid">
        <SheetHeader title="Moving chat" onClose={() => navigation.goBack()} />
        <View className="gap-4 p-4">
          <ThreadMoveNotice environmentId={environmentId} threadId={threadId} />
          <Text>You can close this view. The move continues on the server.</Text>
        </View>
      </View>
    );
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-sheet-solid">
      <SheetHeader
        title="Move chat"
        onCancel={() => navigation.goBack()}
        confirm={{
          label: instruction.trim() ? "Move and send" : "Move",
          onPress: () => void submit(),
          disabled: !!blocked || !projectId || pending,
          loading: pending,
        }}
      />
      <ScreenContent>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 p-4 pb-10">
          <Text>Continue this conversation on another machine.</Text>
          <ListSection
            title="Machine"
            footer={
              query.isPending
                ? "Checking available machines…"
                : options.length === 0
                  ? "Link a machine in Settings → Connections first."
                  : undefined
            }
          >
            {options.map((option, index) => (
              <ListChoiceRow
                key={option.environmentId}
                label={option.label}
                description={option.reason ?? undefined}
                selected={target?.environmentId === option.environmentId}
                separated={index > 0}
                onPress={() => {
                  setMachine(option.environmentId);
                  setProject(null);
                }}
              />
            ))}
          </ListSection>
          {target && target.projects.length > 1 ? (
            <ListSection title="Project">
              {target.projects.map((item, index) => (
                <ListChoiceRow
                  key={item.id}
                  label={item.title}
                  selected={projectId === item.id}
                  separated={index > 0}
                  onPress={() => setProject(item.id)}
                />
              ))}
            </ListSection>
          ) : target?.projects[0] ? (
            <Text>Project: {target.projects[0].title}</Text>
          ) : null}
          <Text textRole="footnote" className="text-foreground-muted">
            Moves recent conversation text and captured Git working files. Earlier history stays
            here. Ignored untracked files, attachments, staging and running processes stay here.
            Uses the destination’s worktree setup. New move worktrees are disposable: safely
            captured checkouts are removed after a later move. Stop external writers; local-only
            work keeps its source.
          </Text>
          <ListSection title="Next instruction (optional)">
            <View className="p-4">
              <AppTextInput
                accessibilityLabel="Next instruction"
                multiline
                value={instruction}
                onChangeText={setInstruction}
                placeholder="Run the Linux tests and fix any failures"
              />
            </View>
          </ListSection>
          {error || blocked || query.error ? (
            <Notice message={String(error ?? blocked ?? query.error)} />
          ) : null}
        </ScrollView>
      </ScreenContent>
    </KeyboardAvoidingView>
  );
}

export function ThreadMoveNotice({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const navigation = useNavigation();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const retry = useAtomCommand(threadHandoffEnvironment.retry);
  const move = thread?.handoff;
  const recovery = incomingMoveRecoveryCommand(thread?.importOrigin);
  if (!move && thread?.importOrigin)
    return (
      <View className="px-4 pb-3">
        <Notice
          message={
            recovery
              ? `Moved from ${thread.linkOrigin?.label ?? "another machine"}. Recent text and Git files arrived in a disposable worktree. The original incoming files are retained for recovery. Stop external writers before moving again.`
              : `Moved from ${thread.linkOrigin?.label ?? "another machine"}. Recent text and Git files arrived in a new worktree. Earlier history and local-only resources remain on the source.`
          }
        />
        {recovery ? (
          <Button
            tone="text"
            size="compact"
            label="Copy recovery command"
            onPress={() => void Clipboard.setStringAsync(recovery)}
          />
        ) : null}
      </View>
    );
  if (!move) return null;
  return (
    <View className="gap-2 px-4 pb-3">
      <Notice
        message={
          move.state === "departed"
            ? `Moved to ${move.label}. This copy is read only. ${move.retirement?.reason ?? "Its source files were kept."}`
            : move.state === "failed"
              ? move.lastError
              : (move.lastError ??
                `Moving to ${move.label}. Messages are paused until the destination confirms.`)
        }
      />
      {move.state === "departed" && recovery ? (
        <Button
          tone="text"
          size="compact"
          label="Copy recovery command"
          onPress={() => void Clipboard.setStringAsync(recovery)}
        />
      ) : null}
      <Button
        tone="text"
        size="compact"
        label={
          move.state === "departed"
            ? presentations.get(move.environmentId)?.connection.phase === "connected"
              ? "Open chat"
              : "Connect to open"
            : move.state === "departing"
              ? "Check again"
              : "Try again"
        }
        onPress={() => {
          if (
            move.state === "departed" &&
            presentations.get(move.environmentId)?.connection.phase !== "connected"
          ) {
            navigation.navigate("Connections");
            return;
          }
          if (move.state === "departed")
            navigation.dispatch(
              StackActions.replace("Thread", {
                environmentId: String(move.environmentId),
                threadId: String(move.threadId),
              }),
            );
          else if (move.state === "departing") void retry({ environmentId, input: { threadId } });
          else
            navigation.navigate("ThreadMove", {
              environmentId,
              threadId,
              draftKey: `${environmentId}:${threadId}`,
            });
        }}
      />
    </View>
  );
}
