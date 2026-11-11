import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OrchestratorMcpFailure,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadHandoff,
  type OrchestratorMcpThreadImportInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessions from "../../orchestration-v2/ProviderSessionManager.ts";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as RepositoryIdentity from "../../project/RepositoryIdentityResolver.ts";
import * as Schedules from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Terminal from "../../terminal/Manager.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as PeerForwarding from "../PeerForwarding.ts";
import * as PeerLinks from "../PeerLinks.ts";
import { descriptorOf } from "../PeerLinks.testkit.ts";
import { liveThreadShell, idleThreadProjection } from "../../mcp/McpToolAccess.testkit.ts";
import * as HandoffGit from "./HandoffGit.ts";
import * as ThreadHandoff from "./ThreadHandoff.ts";

const id = ThreadId.make("source");
const there = descriptorOf("destination", "Ubuntu", { threadHandoffProtocol: 1 });
const here = descriptorOf("source", "Laptop", { threadHandoffProtocol: 1 });
const acceptedId = ThreadId.make("destination-chat");

it.effect.each([
  "lost-response",
  "strong-receipt",
  "owned-receipt",
  "refused",
  "interrupted-capture",
] as const)("a %s preserves the original move identity and ownership", (outcome) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sandbox = yield* fs.makeTempDirectoryScoped({ prefix: "t3-move-recovery-" });
    const config = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(sandbox, path.join(sandbox, "state"))),
    );
    const owned = outcome === "owned-receipt";
    const strong = owned || outcome === "strong-receipt";
    const sourceRoot = owned
      ? path.join(config.worktreesDir, "moves", "incoming-fixture")
      : sandbox;
    yield* fs.makeDirectory(sourceRoot, { recursive: true });
    const root = yield* fs.realPath(sourceRoot);
    const alias = path.join(sandbox, "workspace-alias");
    yield* fs.symlink(sandbox, alias);
    const shell = {
      ...liveThreadShell(id, { activeRunId: null }),
      status: "idle" as const,
      ...(owned
        ? {
            worktreePath: root,
            branch: "move/incoming-fixture",
            importOrigin: {
              environmentId: here.environmentId,
              threadId: id,
              handoffId: "incoming-fixture",
              fingerprint: "native",
              incomingSnapshot: {
                snapshot: "c".repeat(40),
                ref: "refs/t3code/moves/incoming-fixture/incoming",
              },
            },
          }
        : {}),
    };
    let projection = idleThreadProjection(shell);
    let handoff: OrchestrationV2ThreadHandoff | undefined;
    const sent = yield* Deferred.make<void>();
    const capturing = yield* Deferred.make<void>();
    const requests: OrchestratorMcpThreadImportInput[] = [];
    let packs = 0;
    let uploads = 0;
    let changedLink = false;
    const linkedAt = DateTime.makeUnsafe("2026-11-01T00:00:00Z");
    const link = {
      environmentId: there.environmentId,
      label: there.label,
      linkedAt,
      status: "reachable" as const,
    };
    const dispatch = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: () =>
        Effect.succeed({
          ...projection,
          thread: { ...projection.thread, ...(handoff ? { handoff } : {}) },
        }),
      getThreadSnapshotWindow: () =>
        Effect.succeed({ schemaVersion: 1, snapshotSequence: 0, projection }),
      dispatch: (command) =>
        Effect.sync(() => {
          if (command.type === "thread.handoff.update" && command.handoff) {
            handoff = command.handoff;
            projection = { ...projection, thread: { ...projection.thread, handoff } };
          }
          return { sequence: 1, storedEvents: [] };
        }),
    });
    const call = ((_: unknown, tool: { name: string }, __: unknown, input: unknown) =>
      Effect.gen(function* () {
        if (tool.name === "t3_project_list")
          return {
            projects: [
              {
                id: ProjectId.make("destination-project"),
                title: "App",
                repositoryIdentity: { canonicalKey: "repo" },
              },
            ],
            nextCursor: null,
          };
        if (tool.name === "t3_attachment_prepare_upload")
          return { attachmentId: `pending:upload-${requests.length}`, relativeUrl: "/upload" };
        requests.push(input as OrchestratorMcpThreadImportInput);
        yield* Deferred.succeed(sent, undefined);
        if (outcome === "refused" || requests.length === 1)
          return yield* new OrchestratorMcpFailure({
            code: outcome === "refused" ? "invalid_request" : "orchestration_error",
            message: "Simulated destination response",
          });
        return {
          threadId: acceptedId,
          projectId: ProjectId.make("destination-project"),
          created: false,
          runId: null,
          ...(strong
            ? {
                incomingSnapshot: {
                  version: 1,
                  snapshot: "b".repeat(40),
                  ref: `refs/t3code/moves/${(input as OrchestratorMcpThreadImportInput).source.handoffId}/incoming`,
                },
              }
            : {}),
        };
      })) as PeerForwarding.PeerForwarding["Service"]["call"];
    const dependencies = Layer.mergeAll(
      dispatch,
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({
            schemaVersion: 1,
            snapshotSequence: 0,
            threads: [shell],
            archivedThreads: [],
            projects: [],
            updatedAt: linkedAt,
          }),
      }),
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeedSome({ id: shell.projectId, workspaceRoot: alias } as never),
      }),
      Layer.mock(RepositoryIdentity.RepositoryIdentityResolver)({
        resolve: () => Effect.succeed({ canonicalKey: "repo" } as never),
      }),
      Layer.mock(PeerForwarding.PeerForwarding)({ call }),
      Layer.mock(PeerLinks.PeerLinks)({
        list: Effect.succeed([link] as never),
        resolve: () => Effect.succeed({ url: "http://destination", handoffProtocol: 1 } as never),
        get: () =>
          Effect.succeedSome({
            ...link,
            linkedAt: changedLink ? DateTime.makeUnsafe("2026-11-02T00:00:00Z") : linkedAt,
          } as never),
      }),
      Layer.mock(HandoffGit.HandoffGit)({
        pack: ({ outDir, handoffId }) =>
          Effect.gen(function* () {
            packs++;
            if (outcome === "interrupted-capture") {
              yield* Deferred.succeed(capturing, undefined);
              return yield* Effect.never;
            }
            const bundlePath = path.join(outDir, `${handoffId}.bundle`);
            yield* fs.writeFileString(bundlePath, "frozen-files").pipe(Effect.orDie);
            return {
              bundlePath,
              bundleBytes: 12,
              branch: "main",
              tip: "a".repeat(40),
              snapshot: "b".repeat(40),
              baseRemoteUrl: null,
            };
          }),
      }),
      Layer.mock(VcsProcess.VcsProcess)({
        run: () =>
          fs.realPath(root).pipe(
            Effect.map((real) => ({ stdout: real }) as never),
            Effect.orDie,
          ),
      }),
      Layer.mock(ProviderSessions.ProviderSessionManagerV2)({}),
      Layer.mock(Providers.ProviderRegistry)({
        getProviders: Effect.succeed([
          { instanceId: projection.thread.modelSelection.instanceId, driver: "codex" },
        ] as never),
      }),
      Layer.mock(Schedules.ScheduledTaskService)({
        list: () => Effect.succeed({ tasks: [] } as never),
      }),
      Layer.mock(Terminal.TerminalManager)({
        hasWorkspaceSubprocess: () => Effect.succeed(false),
      }),
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(here.environmentId),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() =>
          Effect.sync(() => {
            uploads++;
            return HttpClientResponse.fromWeb(
              HttpClientRequest.post("http://destination/upload"),
              new Response(null, { status: 204 }),
            );
          }),
        ),
      ),
      Layer.succeed(ServerConfig.ServerConfig, config),
    );
    yield* Effect.gen(function* () {
      const service = yield* ThreadHandoff.ThreadHandoff;
      if (outcome === "interrupted-capture") {
        const running = yield* service
          .start({ threadId: id, environmentId: there.environmentId })
          .pipe(Effect.forkChild);
        yield* Deferred.await(capturing);
        yield* Fiber.interrupt(running);
        assert.equal(handoff?.state, "departing");
        const recovered = yield* service.retry(id);
        assert.equal(recovered.state, "failed");
        assert.equal(requests.length, 0);
        return;
      }
      const started = yield* service.start({ threadId: id, environmentId: there.environmentId });
      assert.equal(started.state, "departing");
      yield* Deferred.await(sent);
      if (outcome === "lost-response") {
        changedLink = true;
        const mismatch = yield* service.retry(id).pipe(Effect.flip);
        assert.include(mismatch.message, "link changed");
        assert.equal(handoff?.state, "departing");
        assert.equal(requests.length, 1);
        changedLink = false;
      }
      const checked = yield* service.retry(id);
      if (outcome === "refused") {
        assert.equal(checked.state, "failed");
        assert.equal(requests.length, 1);
      } else {
        assert.equal(checked.state, "departed");
        assert.equal(requests.length, 2);
        assert.deepEqual(
          { ...requests[0], bundle: { ...requests[0]!.bundle, attachmentId: "normalized" } },
          { ...requests[1], bundle: { ...requests[1]!.bundle, attachmentId: "normalized" } },
        );
        assert.equal(packs, 1);
        assert.equal(uploads, 1);
        const saved = path.join(config.stateDir, "thread-moves", checked.handoffId, "request.json");
        assert.equal(yield* fs.exists(saved), !strong);
        if (checked.state === "departed" && strong) {
          assert.equal(checked.retirement?.disposable, owned);
          const changed = yield* service
            .start({
              threadId: id,
              environmentId: there.environmentId,
              continuationPrompt: "Changed instruction",
            })
            .pipe(Effect.flip);
          assert.include(changed.message, "different project or instruction");
        }
        assert.equal(
          (yield* service.start({ threadId: id, environmentId: there.environmentId })).state,
          "departed",
        );
        assert.equal((yield* service.retry(id)).state, "departed");
        assert.equal(requests.length, 2);
      }
      assert.equal(handoff?.state, checked.state);
      assert.equal(requests[0]?.bundle?.relativeCwd, "");
    }).pipe(Effect.provide(ThreadHandoff.layer.pipe(Layer.provideMerge(dependencies))));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeCrypto.layer, NodeServices.layer))),
);
