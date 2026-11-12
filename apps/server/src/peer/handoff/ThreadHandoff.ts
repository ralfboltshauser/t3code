import { formatThreadLink } from "@t3tools/shared/threadLinks";
import {
  CommandId,
  OrchestratorMcpThreadImportInput,
  ThreadHandoffError,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadHandoff,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerConfig from "../../config.ts";
import type * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { AttachmentToolkit } from "../../mcp/toolkits/attachment/tools.ts";
import { ProjectToolkit } from "../../mcp/toolkits/project/tools.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as ProviderSessions from "../../orchestration-v2/ProviderSessionManager.ts";
import { forkParked } from "../../serverActivation.ts";
import * as PeerForwarding from "../PeerForwarding.ts";
import * as PeerLinks from "../PeerLinks.ts";
import * as ScheduledTasks from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Terminal from "../../terminal/Manager.ts";
import * as HandoffGit from "./HandoffGit.ts";
import { workspaceAdmissionPath } from "../../workspace/workspaceAdmissionPath.ts";

interface StartInput {
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | undefined;
  readonly continuationPrompt?: string | undefined;
}
interface Target {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly projectId: ProjectId | null;
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly reason: string | null;
}
const FrozenMove = Schema.Struct({
  input: OrchestratorMcpThreadImportInput,
  bundlePath: Schema.String,
  bundleBytes: Schema.Number,
  linkedAt: Schema.String,
  sent: Schema.Boolean,
});
type FrozenMove = typeof FrozenMove.Type;
const encodeFrozenMove = Schema.encodeEffect(Schema.fromJsonString(FrozenMove));
const decodeFrozenMove = Schema.decodeUnknownEffect(Schema.fromJsonString(FrozenMove));

export class ThreadHandoff extends Context.Service<
  ThreadHandoff,
  {
    readonly options: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<Target>, ThreadHandoffError>;
    readonly start: (
      input: StartInput,
    ) => Effect.Effect<OrchestrationV2ThreadHandoff, ThreadHandoffError>;
    readonly retry: (
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadHandoff, ThreadHandoffError>;
    readonly start_: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peer/handoff/ThreadHandoff") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const identities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const forwarding = yield* PeerForwarding.PeerForwarding;
  const links = yield* PeerLinks.PeerLinks;
  const git = yield* HandoffGit.HandoffGit;
  const processes = yield* VcsProcess.VcsProcess;
  const sessions = yield* ProviderSessions.ProviderSessionManagerV2;
  const providers = yield* Providers.ProviderRegistry;
  const schedules = yield* ScheduledTasks.ScheduledTaskService;
  const terminals = yield* Terminal.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  const crypto = yield* Digest.Digest;
  const promptDigest = Effect.fn("ThreadHandoff.promptDigest")(function* (
    prompt: string | undefined,
  ) {
    return Hex.encode(
      yield* crypto.digest(Digest.sha256, new TextEncoder().encode(prompt?.trim() ?? "")),
    );
  });
  const http = yield* HttpClient.HttpClient;
  const scope = yield* Scope.Scope;
  const locks = yield* KeyedLock.make<ThreadId>();
  const here = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const failure = (message: string, cause?: unknown) =>
    new ThreadHandoffError({
      reason: "refused",
      message,
      ...(cause === undefined ? {} : { cause }),
    });
  const scopeFor = (thread: OrchestrationV2AppThread): McpInvocationContext.McpInvocationScope => ({
    environmentId: here,
    requestNamespace: `move:${thread.id}`,
    thread: undefined,
    client: {
      sessionId: `move:${thread.id}`,
      label: "T3 Code move",
      access: thread.runtimeMode,
      narrowedTo: { runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode },
    },
    capabilities: new Set(["orchestration"]),
    issuedAt: 0,
  });
  const operationDir = (id: string) => path.join(config.stateDir, "thread-moves", id);
  const disposableSource = Effect.fn("ThreadHandoff.disposableSource")(
    function* (thread: OrchestrationV2AppThread, root: string) {
      const origin = thread.importOrigin;
      if (
        !origin?.incomingSnapshot ||
        thread.worktreePath !== root ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(origin.handoffId)
      )
        return false;
      const managed = yield* fs.realPath(config.worktreesDir);
      if (path.join(managed, "moves", origin.handoffId) !== root) return false;
      const snapshot = yield* projections.getShellSnapshot();
      for (const other of [...snapshot.threads, ...snapshot.archivedThreads]) {
        if (other.id === thread.id) continue;
        const project =
          other.worktreePath === null ? yield* projects.getById(other.projectId) : Option.none();
        const cwd =
          other.worktreePath ?? (Option.isSome(project) ? project.value.workspaceRoot : null);
        if (!cwd) continue;
        const canonical = yield* workspaceAdmissionPath(cwd).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
        const relative = path.relative(root, canonical);
        const inverse = path.relative(canonical, root);
        if (
          relative === "" ||
          (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
          (!inverse.startsWith("..") && !path.isAbsolute(inverse)) ||
          (thread.branch !== null &&
            other.branch === thread.branch &&
            other.handoff?.state !== "departed")
        )
          return false;
      }
      return true;
    },
    Effect.orElseSucceed(() => false),
  );
  const pruneResolved = Effect.fn("ThreadHandoff.pruneResolved")(
    function* (handoff: OrchestrationV2ThreadHandoff) {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(handoff.handoffId)) return;
      if (handoff.state !== "failed" && (handoff.state !== "departed" || !handoff.retirement))
        return;
      const dir = operationDir(handoff.handoffId);
      if (!(yield* fs.exists(dir))) return;
      for (const name of [
        "request.json",
        "request.tmp",
        "preparing",
        `${handoff.handoffId}.bundle`,
      ])
        yield* fs.remove(path.join(dir, name), { force: true });
      if ((yield* fs.readDirectory(dir)).length === 0) yield* fs.remove(dir, { recursive: true });
    },
    Effect.ignoreCause({ log: true }),
  );
  const read = Effect.fn("ThreadHandoff.read")(function* (threadId: ThreadId) {
    return yield* threads
      .getThreadRecords(threadId, [
        "runs",
        "runtimeRequests",
        "subagents",
        "providerSessions",
        "providerThreads",
        "messages",
      ])
      .pipe(Effect.mapError((cause) => failure("Could not read this chat.", cause)));
  });
  const set = Effect.fn("ThreadHandoff.set")(function* (
    threadId: ThreadId,
    expected: OrchestrationV2ThreadHandoff["state"] | null,
    handoff: OrchestrationV2ThreadHandoff,
    step: string,
  ) {
    yield* threads
      .dispatch({
        type: "thread.handoff.update",
        commandId: CommandId.make(`move:${handoff.handoffId}:${step}`),
        threadId,
        expected,
        handoff,
      })
      .pipe(
        Effect.mapError((cause) =>
          failure("The chat changed before the move could continue.", cause),
        ),
      );
  });
  const save = Effect.fn("ThreadHandoff.save")(
    function* (id: string, record: FrozenMove) {
      const dir = operationDir(id);
      yield* fs.makeDirectory(dir, { recursive: true });
      const json = yield* encodeFrozenMove(record);
      yield* fs.writeFileString(path.join(dir, "request.tmp"), json);
      yield* fs.rename(path.join(dir, "request.tmp"), path.join(dir, "request.json"));
    },
    Effect.mapError((cause) => failure("Could not save the move for recovery.", cause)),
  );

  const matchedProjects = Effect.fn("ThreadHandoff.matchedProjects")(function* (
    thread: OrchestrationV2AppThread,
    environmentId: EnvironmentId,
  ) {
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.mapError((cause) => failure("Could not read the project.", cause)));
    const identity = Option.isNone(project)
      ? undefined
      : yield* identities.resolve(project.value.workspaceRoot, { refresh: true });
    if (!identity) return yield* failure("This chat needs a Git repository before it can move.");
    const matches: Array<{ id: ProjectId; title: string }> = [];
    let cursor: number | undefined;
    do {
      const listed = yield* forwarding
        .call(scopeFor(thread), ProjectToolkit.tools.t3_project_list, environmentId, {
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        })
        .pipe(
          Effect.mapError((cause) =>
            failure("Could not read projects on the other machine.", cause),
          ),
        );
      matches.push(
        ...listed.projects
          .filter(
            (candidate) => candidate.repositoryIdentity?.canonicalKey === identity.canonicalKey,
          )
          .map(({ id, title }) => ({ id, title })),
      );
      if (listed.nextCursor === null) break;
      if (cursor !== undefined && listed.nextCursor <= cursor)
        return yield* failure("The project list changed. Try again.");
      cursor = listed.nextCursor;
    } while (true);
    return matches;
  });
  const options = Effect.fn("ThreadHandoff.options")(function* (threadId: ThreadId) {
    const { thread } = yield* read(threadId);
    const listed = yield* links.list.pipe(
      Effect.mapError((cause) => failure("Could not load linked machines.", cause)),
    );
    return yield* Effect.forEach(
      listed.filter((link) => link.environmentId !== here),
      (link) =>
        Effect.gen(function* () {
          const base = { environmentId: link.environmentId, label: link.label };
          if (link.status !== "reachable")
            return {
              ...base,
              projectId: null,
              projects: [],
              reason:
                link.status === "expired"
                  ? "Link expired. Link this machine again."
                  : "Not reachable right now.",
            };
          const resolved = yield* links
            .resolve(link.environmentId)
            .pipe(Effect.mapError((cause) => failure("Could not check the other machine.", cause)));
          if (resolved.handoffProtocol !== 1)
            return {
              ...base,
              projectId: null,
              projects: [],
              reason: "Update T3 Code on this machine to support moving chats.",
            };
          const matches = yield* matchedProjects(thread, link.environmentId);
          return {
            ...base,
            projectId: matches.length === 1 ? matches[0]!.id : null,
            projects: matches,
            reason: matches.length === 0 ? "Add this repository on that machine first." : null,
          };
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              environmentId: link.environmentId,
              label: link.label,
              projectId: null,
              projects: [],
              reason: error.message,
            }),
          ),
        ),
      { concurrency: 4 },
    );
  });

  const upload = Effect.fn("ThreadHandoff.upload")(
    function* (thread: OrchestrationV2AppThread, record: FrozenMove) {
      const environmentId = thread.handoff!.environmentId;
      const prepared = yield* forwarding.call(
        scopeFor(thread),
        AttachmentToolkit.tools.t3_attachment_prepare_upload,
        environmentId,
        {
          upload: {
            type: "file",
            name: `${record.input.bundle!.snapshot.slice(0, 12)}.bundle`,
            mimeType: "application/x-git-bundle",
            sizeBytes: record.bundleBytes,
          },
        },
      );
      const resolved = yield* links.resolve(environmentId);
      const bytes = yield* fs.readFile(record.bundlePath);
      const response = yield* http.execute(
        HttpClientRequest.post(`${resolved.url}${prepared.relativeUrl}`).pipe(
          HttpClientRequest.setBody(HttpBody.uint8Array(bytes, "application/x-git-bundle")),
        ),
      );
      if (response.status !== 204)
        return yield* failure("The other machine could not receive the Git changes.");
      return prepared.attachmentId;
    },
    Effect.mapError((cause) =>
      failure("Could not upload the Git changes. Check the connection and try again.", cause),
    ),
  );

  const depart = Effect.fn("ThreadHandoff.depart")(function* (threadId: ThreadId) {
    return yield* locks.withLock(
      threadId,
      Effect.gen(function* () {
        const records = yield* read(threadId);
        const { thread } = records;
        const handoff = thread.handoff;
        if (!handoff) return yield* failure("This chat has no move to check.");
        if (handoff.state !== "departing") {
          yield* pruneResolved(handoff);
          return handoff;
        }
        const filename = path.join(operationDir(handoff.handoffId), "request.json");
        if (
          !(yield* fs
            .exists(filename)
            .pipe(Effect.mapError((cause) => failure("Could not read the saved move.", cause))))
        ) {
          const preparing = path.join(operationDir(handoff.handoffId), "preparing");
          if (
            !handoff.captureReady &&
            !handoff.sent &&
            (yield* fs.exists(preparing).pipe(Effect.orElseSucceed(() => false)))
          ) {
            const failed = {
              ...handoff,
              state: "failed" as const,
              lastError:
                "Workspace capture was interrupted before anything was sent. Try moving again.",
            };
            yield* set(threadId, "departing", failed, "preparation-interrupted");
            yield* pruneResolved(failed);
            return failed;
          }
          return yield* failure(
            "The saved move is missing. Confirm the destination before working here again.",
          );
        }
        yield* fs
          .remove(path.join(operationDir(handoff.handoffId), "preparing"), { force: true })
          .pipe(Effect.mapError((cause) => failure("Could not finish preparing the move.", cause)));
        const record = yield* fs.readFileString(filename).pipe(
          Effect.flatMap(decodeFrozenMove),
          Effect.mapError((cause) =>
            failure("The saved move needs attention. The chat remains paused.", cause),
          ),
        );
        const triedBefore = record.sent || handoff.sent === true;
        const link = yield* links
          .get(handoff.environmentId)
          .pipe(
            Effect.mapError((cause) =>
              failure("Could not check the original machine link.", cause),
            ),
          );
        if (Option.isNone(link) || DateTime.formatIso(link.value.linkedAt) !== record.linkedAt)
          return yield* failure(
            "The original link changed. Confirm the destination move before working here again.",
          );
        const accepted = triedBefore
          ? yield* forwarding
              .call(
                scopeFor(thread),
                ProjectToolkit.tools.t3_thread_import,
                handoff.environmentId,
                record.input,
              )
              .pipe(Effect.option)
          : Option.none();
        const uploaded = Option.isSome(accepted)
          ? Result.succeed("")
          : yield* upload(thread, record).pipe(Effect.result);
        if (uploaded._tag === "Failure") {
          const stopped = triedBefore
            ? { ...handoff, lastError: uploaded.failure.message }
            : { ...handoff, state: "failed" as const, lastError: uploaded.failure.message };
          yield* set(
            threadId,
            "departing",
            stopped,
            triedBefore ? "upload-uncertain" : "upload-failed",
          );
          yield* pruneResolved(stopped);
          return stopped;
        }
        const attachmentId = uploaded.success;
        if (Option.isNone(accepted))
          yield* set(
            threadId,
            "departing",
            { ...handoff, captureReady: true, sent: true },
            "sending",
          );
        if (Option.isNone(accepted)) yield* save(handoff.handoffId, { ...record, sent: true });
        const result = Option.isSome(accepted)
          ? Result.succeed(accepted.value)
          : yield* forwarding
              .call(
                scopeFor(thread),
                ProjectToolkit.tools.t3_thread_import,
                handoff.environmentId,
                {
                  ...record.input,
                  bundle: { ...record.input.bundle!, attachmentId },
                },
              )
              .pipe(Effect.result);
        if (result._tag === "Failure") {
          if (
            !triedBefore &&
            [
              "invalid_request",
              "runtime_mode_escalation_denied",
              "interaction_mode_escalation_denied",
              "model_unavailable",
              "provider_unavailable",
            ].includes(result.failure.code)
          ) {
            const failed = {
              state: "failed" as const,
              handoffId: handoff.handoffId,
              environmentId: handoff.environmentId,
              label: handoff.label,
              lastError: result.failure.message,
            };
            yield* set(threadId, "departing", failed, "refused");
            yield* pruneResolved(failed);
            return failed;
          }
          // An uncertain send can already own a destination; later errors cannot release the source.
          const uncertain = {
            ...handoff,
            captureReady: true,
            sent: true,
            lastError:
              "Could not confirm the destination. This chat stays paused; Check again resumes the same move.",
          };
          yield* set(threadId, "departing", uncertain, "uncertain");
          return uncertain;
        }
        if (record.input.continuationPrompt && result.success.runId === null)
          return yield* failure(
            "The destination saved history but has not accepted the instruction yet. Check again to resume this move.",
          );
        const departed = {
          state: "departed" as const,
          handoffId: handoff.handoffId,
          environmentId: handoff.environmentId,
          label: handoff.label,
          threadId: result.success.threadId,
          request: {
            projectId: record.input.projectId,
            continuationDigest: yield* promptDigest(record.input.continuationPrompt),
          },
          link: formatThreadLink(
            { environmentId: handoff.environmentId, threadId: result.success.threadId },
            thread.title,
          ),
          ...(handoff.workspaceRoot &&
          result.success.incomingSnapshot?.version === 1 &&
          result.success.incomingSnapshot.snapshot === record.input.bundle?.snapshot &&
          result.success.incomingSnapshot?.ref === `refs/t3code/moves/${handoff.handoffId}/incoming`
            ? {
                retirement: {
                  root: handoff.workspaceRoot,
                  tip: record.input.bundle!.tip,
                  snapshot: record.input.bundle!.snapshot,
                  disposable: yield* disposableSource(thread, handoff.workspaceRoot),
                  status: "pending" as const,
                  reason: "Checking whether the disposable source can be removed safely.",
                },
              }
            : {}),
        };
        for (const session of records.providerSessions)
          yield* sessions
            .releaseUnlessBusy({
              providerSessionId: session.id,
              ownProviderThreadIds: records.providerThreads.map((entry) => entry.id),
              reason: "manual_shutdown",
              detail: "This chat moved to another machine.",
            })
            .pipe(Effect.ignore);
        yield* set(threadId, "departing", departed, "accepted");
        yield* pruneResolved(departed);
        return departed;
      }),
    );
  });

  const begin = Effect.fn("ThreadHandoff.begin")(function* (input: StartInput) {
    return yield* locks.withLock(
      input.threadId,
      Effect.gen(function* () {
        const records = yield* read(input.threadId);
        const thread = records.thread;
        if (thread.handoff?.state === "failed") yield* pruneResolved(thread.handoff);
        if (thread.handoff && thread.handoff.state !== "failed") return thread.handoff;
        if (
          thread.archivedAt ||
          thread.deletedAt ||
          thread.lineage.parentThreadId ||
          Orchestrator.threadHasUnfinishedWork(records)
        )
          return yield* failure(
            "Move an independent idle chat. Finish or stop its work and resolve queued messages and requests first.",
          );
        if (
          records.subagents.some((task) => ["pending", "running", "waiting"].includes(task.status))
        )
          return yield* failure("Finish or stop this chat's background work before moving.");
        const goal = records.providerThreads.find(
          (providerThread) => providerThread.id === thread.activeProviderThreadId,
        )?.goal;
        if (goal && goal.status !== "complete")
          return yield* failure("Complete or clear this chat’s goal before moving.");
        if (thread.pullRequests?.some((link) => link.watch !== undefined))
          return yield* failure(
            "Stop this chat’s PR watches before moving. They stay on this machine.",
          );
        for (const session of records.providerSessions) {
          const runtime = yield* sessions
            .get(session.id)
            .pipe(
              Effect.mapError((cause) =>
                failure("Could not confirm that background work stopped.", cause),
              ),
            );
          if (Option.isNone(runtime)) continue;
          const probes =
            !session.capabilities.sessions.supportsMultipleProviderThreadsPerSession &&
            runtime.value.hasPendingBackgroundWork
              ? [runtime.value.hasPendingBackgroundWork]
              : records.providerThreads.flatMap((providerThread) =>
                  providerThread.providerSessionId === session.id &&
                  runtime.value.hasPendingBackgroundWorkForThread
                    ? [runtime.value.hasPendingBackgroundWorkForThread(providerThread)]
                    : [],
                );
          for (const probe of probes)
            if (yield* probe.pipe(Effect.catchCause(() => Effect.succeed(true))))
              return yield* failure(
                "Wait for the provider's background work to stop before moving.",
              );
        }
        const targets = yield* options(thread.id);
        const target = targets.find((candidate) => candidate.environmentId === input.environmentId);
        if (!target || target.reason)
          return yield* failure(target?.reason ?? "Choose a linked destination machine.");
        const projectId = input.projectId ?? target.projectId;
        if (!projectId || !target.projects.some((project) => project.id === projectId))
          return yield* failure("Choose the matching project on the other machine.");
        const sourceProject = yield* projects
          .getById(thread.projectId)
          .pipe(Effect.mapError((cause) => failure("Could not read the source project.", cause)));
        if (Option.isNone(sourceProject))
          return yield* failure("The source project no longer exists.");
        const cwd = thread.worktreePath ?? sourceProject.value.workspaceRoot;
        const gitRoot = yield* processes
          .run({
            operation: "ThreadHandoff.workspaceRoot",
            command: "git",
            cwd,
            args: ["rev-parse", "--show-toplevel"],
          })
          .pipe(
            Effect.mapError((cause) =>
              failure("This chat needs an initialized Git worktree before moving.", cause),
            ),
          );
        const workspaceRoot = yield* fs
          .realPath(gitRoot.stdout.trim())
          .pipe(Effect.mapError((cause) => failure("Could not resolve this workspace.", cause)));
        const tasks = yield* schedules
          .list()
          .pipe(Effect.mapError((cause) => failure("Could not check scheduled work.", cause)));
        if (tasks.tasks.some((task) => task.enabled && task.threadId === thread.id))
          return yield* failure(
            "Disable this chat’s scheduled tasks before moving. They stay on this machine.",
          );
        if (yield* terminals.hasWorkspaceSubprocess(workspaceRoot))
          return yield* failure(
            "Stop commands running in this workspace’s terminals before moving.",
          );
        const shells = yield* projections
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => failure("Could not check workspace activity.", cause)));
        if (
          shells.threads.some(
            (other) =>
              other.id !== thread.id &&
              (other.worktreePath ??
                (other.projectId === thread.projectId ? sourceProject.value.workspaceRoot : "")) ===
                cwd &&
              ["running", "starting", "preparing", "waiting", "queued"].includes(
                other.status ?? "",
              ),
          )
        )
          return yield* failure(
            "Another chat is using this workspace. Finish its work before moving.",
          );
        const sourceProvider = (yield* providers.getProviders).find(
          (provider) => provider.instanceId === thread.modelSelection.instanceId,
        );
        if (!sourceProvider)
          return yield* failure("The chat’s provider is no longer registered on this machine.");
        const handoffId = yield* random.uuidV4();
        const handoff = {
          state: "departing" as const,
          handoffId,
          environmentId: target.environmentId,
          label: target.label,
          workspaceRoot,
        };
        const dir = operationDir(handoffId);
        yield* fs
          .makeDirectory(dir, { recursive: true })
          .pipe(Effect.mapError((cause) => failure("Could not prepare move storage.", cause)));
        yield* fs
          .writeFileString(path.join(dir, "preparing"), handoffId)
          .pipe(Effect.mapError((cause) => failure("Could not persist move preparation.", cause)));
        yield* set(thread.id, thread.handoff?.state ?? null, handoff, "begin");
        const prepared = yield* Effect.gen(function* () {
          const packed = yield* git.pack({ cwd, handoffId, outDir: dir }).pipe(Effect.scoped);
          const root = yield* processes.run({
            operation: "ThreadHandoff.root",
            command: "git",
            cwd,
            args: ["rev-parse", "--show-toplevel"],
          });
          const relativeCwd = path.relative(
            yield* fs.realPath(root.stdout.trim()),
            yield* fs.realPath(cwd),
          );
          const snapshot = yield* threads
            .getThreadSnapshotWindow(thread.id, { rowLimit: 4000 })
            .pipe(
              Effect.mapError((cause) => failure("Could not capture conversation history.", cause)),
            );
          let remaining = 1_500_000;
          const messages = snapshot.projection.visibleTurnItems
            .toReversed()
            .flatMap(({ item }) => {
              if (
                (item.type !== "user_message" && item.type !== "assistant_message") ||
                (item.type === "assistant_message" && item.streaming) ||
                !item.text.trim()
              )
                return [];
              const bytes = new TextEncoder().encode(item.text).byteLength;
              if (bytes > remaining || item.text.length > 200_000) return [];
              remaining -= bytes;
              return [
                {
                  role: item.type === "user_message" ? ("user" as const) : ("assistant" as const),
                  text: item.text,
                  createdAt: DateTime.formatIso(item.startedAt ?? item.updatedAt),
                },
              ];
            })
            .slice(0, 2000)
            .toReversed();
          const link = yield* links.get(target.environmentId);
          if (Option.isNone(link)) return yield* failure("The destination link disappeared.");
          yield* save(handoffId, {
            input: {
              source: { environmentId: here, threadId: thread.id, handoffId },
              projectId,
              title: thread.title,
              modelSelection: thread.modelSelection,
              sourceProviderDriver: sourceProvider.driver,
              runtimeMode: thread.runtimeMode,
              interactionMode: thread.interactionMode,
              messages,
              bundle: {
                attachmentId: "pending",
                tip: packed.tip,
                snapshot: packed.snapshot,
                relativeCwd,
              },
              ...(input.continuationPrompt?.trim()
                ? { continuationPrompt: input.continuationPrompt.trim() }
                : {}),
            },
            bundlePath: packed.bundlePath,
            bundleBytes: packed.bundleBytes,
            linkedAt: DateTime.formatIso(link.value.linkedAt),
            sent: false,
          });
          yield* set(thread.id, "departing", { ...handoff, captureReady: true }, "captured");
        }).pipe(Effect.result);
        if (prepared._tag === "Failure") {
          const failed = {
            state: "failed" as const,
            handoffId,
            environmentId: target.environmentId,
            label: target.label,
            lastError:
              "Could not capture this workspace. No move was sent; resolve the Git or storage issue and try again.",
          };
          yield* set(thread.id, "departing", failed, "preparation-failed");
          yield* pruneResolved(failed);
          return failed;
        }
        yield* depart(thread.id).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(scope));
        return handoff;
      }),
    );
  });
  const start = Effect.fn("ThreadHandoff.start")(function* (input: StartInput) {
    const { thread } = yield* read(input.threadId);
    if (thread.handoff && thread.handoff.state !== "failed") {
      if (thread.handoff.environmentId !== input.environmentId)
        return yield* failure(
          "This chat already has a move to another machine. Resolve that move first.",
        );
      if (thread.handoff.state === "departed") {
        if (
          thread.handoff.request &&
          ((input.projectId !== undefined &&
            input.projectId !== thread.handoff.request.projectId) ||
            (yield* promptDigest(input.continuationPrompt)) !==
              thread.handoff.request.continuationDigest)
        )
          return yield* failure(
            "This chat already moved with a different project or instruction. Open the destination or check the original move.",
          );
        yield* pruneResolved(thread.handoff);
        return thread.handoff;
      }
      const saved = yield* fs
        .readFileString(path.join(operationDir(thread.handoff.handoffId), "request.json"))
        .pipe(
          Effect.flatMap(decodeFrozenMove),
          Effect.mapError((cause) =>
            failure("Could not verify the original move. Use its Check again action.", cause),
          ),
        );
      if (
        (input.projectId !== undefined && input.projectId !== saved.input.projectId) ||
        (input.continuationPrompt?.trim() || undefined) !== saved.input.continuationPrompt
      )
        return yield* failure(
          "This chat already has a move with a different project or instruction. Check the original move instead.",
        );
      return thread.handoff.state === "departing" ? yield* depart(thread.id) : thread.handoff;
    }
    return yield* begin(input);
  });
  const start_ = () =>
    forkParked(
      Effect.gen(function* () {
        const snapshot = yield* projections.getShellSnapshot();
        yield* Effect.forEach(
          snapshot.threads.filter(
            (thread) =>
              thread.handoff?.state === "departing" ||
              thread.handoff?.state === "failed" ||
              (thread.handoff?.state === "departed" && thread.handoff.retirement),
          ),
          (thread) => depart(thread.id).pipe(Effect.ignoreCause({ log: true })),
          { concurrency: 4, discard: true },
        );
      }).pipe(Effect.ignoreCause({ log: true })),
    );
  return ThreadHandoff.of({ options, start, retry: depart, start_ });
});
export const layer = Layer.effect(ThreadHandoff, make);
