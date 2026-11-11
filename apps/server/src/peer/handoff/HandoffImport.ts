import {
  isProviderAvailable,
  OrchestratorMcpFailure,
  type OrchestratorMcpThreadImportInput,
  type OrchestrationV2LinkOrigin,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as ServerConfig from "../../config.ts";
import * as ThreadImportService from "../../orchestration-v2/ThreadImportService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as HandoffGit from "./HandoffGit.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { MoveReceipt, MoveWorkspace } from "./MoveWorkspace.ts";
import { moveWorkspaceProvenance } from "./moveWorkspaceMetadata.ts";
import {
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "../../attachmentStore.ts";

type Input = OrchestratorMcpThreadImportInput & {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
};

export class HandoffImport extends Context.Service<
  HandoffImport,
  {
    readonly importThread: (
      input: Input,
    ) => Effect.Effect<
      import("@t3tools/contracts").OrchestratorMcpThreadImportResult,
      OrchestratorMcpFailure
    >;
  }
>()("t3/peer/handoff/HandoffImport") {}

const encodeWorkspaceIdentity = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeWorkspace = Schema.encodeEffect(Schema.fromJsonString(MoveWorkspace));
const decodeWorkspace = Schema.decodeUnknownEffect(Schema.fromJsonString(MoveWorkspace));
const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(MoveReceipt));
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(MoveReceipt));

const make = Effect.gen(function* () {
  const imports = yield* ThreadImportService.ThreadImportService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* HandoffGit.HandoffGit;
  const providers = yield* Providers.ProviderRegistry;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* VcsProcess.VcsProcess;
  const locks = yield* KeyedLock.make<string>();
  const crypto = yield* Digest.Digest;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const prepare = Effect.fn("HandoffImport.prepare")(function* (input: Input) {
    const bundle = input.bundle;
    if (
      !bundle ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(input.source.handoffId) ||
      parseThreadSegmentFromAttachmentId(bundle.attachmentId) !== "pending" ||
      path.isAbsolute(bundle.relativeCwd) ||
      bundle.relativeCwd.split(/[\\/]/).includes("..")
    ) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The move workspace is invalid.",
      });
    }
    const provider = (yield* providers.getProviders).find(
      (candidate) => candidate.instanceId === input.modelSelection.instanceId,
    );
    if (
      !provider ||
      !isProviderAvailable(provider) ||
      !provider.enabled ||
      !provider.installed ||
      provider.status === "error" ||
      provider.auth.status === "unauthenticated"
    )
      return yield* new OrchestratorMcpFailure({
        code: "provider_unavailable",
        message:
          "The chat’s provider is unavailable on this machine. Enable it and sign in before moving.",
      });
    if (input.sourceProviderDriver !== undefined && input.sourceProviderDriver !== provider.driver)
      return yield* new OrchestratorMcpFailure({
        code: "provider_unavailable",
        message:
          "This provider name uses a different runtime on the destination. Configure the matching provider before moving.",
      });
    if (
      provider.models.length > 0 &&
      !provider.models.some((model) => model.slug === input.modelSelection.model)
    )
      return yield* new OrchestratorMcpFailure({
        code: "model_unavailable",
        message: `Model ${input.modelSelection.model} is unavailable on this machine. Choose a supported model in the source chat first.`,
      });
    const project = yield* projects.getById(input.projectId).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not read the destination project.",
          }),
      ),
    );
    if (Option.isNone(project))
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The destination project no longer exists.",
      });
    const bundlePath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: bundle.attachmentId,
    });
    if (!bundlePath)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The move upload is invalid.",
      });
    const worktreePath = path.join(config.worktreesDir, "moves", input.source.handoffId);
    const branch = `move/${input.source.handoffId}`;
    const boundWorkspace = Effect.gen(function* () {
      const root = yield* fs.realPath(worktreePath);
      const cwd = yield* fs.realPath(path.join(worktreePath, bundle.relativeCwd));
      const relative = path.relative(root, cwd);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The chat folder leaves the moved worktree.",
        });
      const owned = yield* fs
        .readFileString(marker)
        .pipe(Effect.flatMap(decodeWorkspace), Effect.option);
      return {
        worktreePath: cwd,
        branch,
        ...(Option.isSome(owned)
          ? {
              incomingSnapshot: {
                snapshot: owned.value.snapshot,
                ref: owned.value.incomingRef,
              },
            }
          : {}),
      };
    }).pipe(
      Effect.mapError((error) =>
        error._tag === "OrchestratorMcpFailure"
          ? error
          : new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "The chat folder is missing from the captured workspace.",
            }),
      ),
    );
    const exists = yield* fs.exists(worktreePath).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not inspect the move workspace.",
          }),
      ),
    );
    const marker = path.join(
      config.stateDir,
      "thread-move-workspaces",
      `${input.source.handoffId}.json`,
    );
    const identity = yield* encodeWorkspaceIdentity({
      source: input.source,
      projectId: input.projectId,
      snapshot: bundle.snapshot,
      tip: bundle.tip,
      relativeCwd: bundle.relativeCwd,
      sessionId: input.linkOrigin?.sessionId,
    }).pipe(Effect.orDie);
    if (exists) {
      const saved = yield* fs.readFileString(marker).pipe(Effect.orElseSucceed(() => ""));
      const owned = yield* decodeWorkspace(saved).pipe(Effect.option);
      if (saved === identity || (Option.isSome(owned) && owned.value.identity === identity))
        return yield* boundWorkspace;
      // A partially prepared workspace can contain work; never reset or remove it on retry.
      return yield* new OrchestratorMcpFailure({
        code: "orchestration_error",
        message:
          "An interrupted workspace preparation needs attention on the destination. Its files were kept.",
      });
    }
    yield* fs.makeDirectory(path.dirname(worktreePath), { recursive: true }).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not create the destination workspace.",
          }),
      ),
    );
    const recoveryRefs = yield* processes
      .run({
        operation: "HandoffImport.capacity",
        command: "git",
        cwd: project.value.workspaceRoot,
        args: ["for-each-ref", "--format=%(refname)", "refs/t3code/moves/"],
        maxOutputBytes: 64 * 1024,
      })
      .pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Could not reserve incoming recovery capacity.",
            }),
        ),
      );
    if (
      recoveryRefs.stdoutTruncated ||
      recoveryRefs.stdout.split("\n").filter((ref) => ref.endsWith("/incoming")).length >= 256
    )
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message:
          "This repository has 256 incoming recovery versions. Review and explicitly discard old recovery versions before moving more work here. Existing files were kept.",
      });
    yield* git
      .apply({
        repoRoot: project.value.workspaceRoot,
        worktreePath,
        handoffId: input.source.handoffId,
        bundlePath,
        branch,
        tip: bundle.tip,
        snapshot: bundle.snapshot,
        ownWorkspace: true,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
        ),
      );
    yield* fs.makeDirectory(path.dirname(marker), { recursive: true }).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not save workspace preparation.",
          }),
      ),
    );
    const rootInfo = yield* fs.stat(worktreePath).pipe(Effect.orDie);
    const gitDir = (yield* processes
      .run({
        operation: "HandoffImport.identity",
        command: "git",
        cwd: worktreePath,
        args: ["rev-parse", "--absolute-git-dir"],
      })
      .pipe(Effect.orDie)).stdout.trim();
    const adminInfo = yield* fs.stat(gitDir).pipe(Effect.orDie);
    const owned = yield* encodeWorkspace({
      version: 1,
      identity,
      source: input.source,
      root: yield* fs.realPath(worktreePath).pipe(Effect.orDie),
      branch,
      tip: bundle.tip,
      snapshot: bundle.snapshot,
      incomingRef: `refs/t3code/moves/${input.source.handoffId}/incoming`,
      gitDir,
      device: String(rootInfo.dev),
      inode: Option.match(rootInfo.ino, { onNone: () => "", onSome: String }),
      adminDevice: String(adminInfo.dev),
      adminInode: Option.match(adminInfo.ino, { onNone: () => "", onSome: String }),
      provenance: yield* moveWorkspaceProvenance(worktreePath).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.orDie,
      ),
    }).pipe(Effect.orDie);
    yield* fs.writeFileString(marker, owned, { flag: "wx", mode: 0o600 }).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not save workspace preparation. The workspace was kept.",
          }),
      ),
    );
    return yield* boundWorkspace;
  });

  const acceptThread = Effect.fn("HandoffImport.acceptThread")(function* (input: Input) {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(input.source.handoffId) && input.bundle)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The move identity is invalid.",
      });
    const encoded = yield* encodeWorkspaceIdentity({
      ...input,
      ...(input.bundle ? { bundle: { ...input.bundle, attachmentId: "content-addressed" } } : {}),
    }).pipe(Effect.orDie);
    const identity = Hex.encode(
      yield* crypto.digest(Digest.sha256, new TextEncoder().encode(encoded)),
    );
    const receiptPath = path.join(
      config.stateDir,
      "thread-move-receipts",
      `${input.source.handoffId}.json`,
    );
    if (input.bundle && (yield* fs.exists(receiptPath).pipe(Effect.orDie))) {
      const receipt = yield* fs.readFileString(receiptPath).pipe(
        Effect.flatMap(decodeReceipt),
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "The saved move receipt needs attention. Its files were kept.",
            }),
        ),
      );
      if (receipt.identity !== identity)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "This move was accepted with different contents or permissions.",
        });
      return { ...receipt.result, created: false };
    }
    const result = yield* imports
      .importThread({ ...input, ...(input.bundle ? { workspace: prepare(input) } : {}) })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "OrchestratorMcpFailure"
            ? error
            : new OrchestratorMcpFailure({
                code:
                  error._tag === "ThreadImportError" ? "orchestration_error" : "invalid_request",
                message: error.message,
              }),
        ),
      );
    if (!input.bundle) return result;
    const workspace = yield* fs
      .readFileString(
        path.join(config.stateDir, "thread-move-workspaces", `${input.source.handoffId}.json`),
      )
      .pipe(Effect.flatMap(decodeWorkspace), Effect.option);
    const accepted = {
      ...result,
      ...(Option.isSome(workspace)
        ? {
            incomingSnapshot: {
              version: 1 as const,
              snapshot: workspace.value.snapshot,
              ref: workspace.value.incomingRef,
            },
          }
        : {}),
    };
    if (accepted.incomingSnapshot && Option.isSome(workspace)) {
      const pinned = yield* processes
        .run({
          operation: "HandoffImport.confirmRecovery",
          command: "git",
          cwd: workspace.value.root,
          args: ["rev-parse", "--verify", accepted.incomingSnapshot.ref],
        })
        .pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: "Could not confirm incoming recovery. The source must be kept.",
              }),
          ),
        );
      if (pinned.stdout.trim() !== input.bundle.snapshot)
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Incoming recovery changed. The source must be kept.",
        });
    }
    yield* fs.makeDirectory(path.dirname(receiptPath), { recursive: true }).pipe(Effect.orDie);
    yield* fs
      .writeFileString(
        `${receiptPath}.tmp`,
        yield* encodeReceipt({ identity, result: accepted }).pipe(Effect.orDie),
        { mode: 0o600 },
      )
      .pipe(
        Effect.andThen(fs.rename(`${receiptPath}.tmp`, receiptPath)),
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Could not save move acceptance. Check again to recover the original move.",
            }),
        ),
      );
    const upload = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: input.bundle.attachmentId,
    });
    if (upload) yield* fs.remove(upload, { force: true }).pipe(Effect.ignore);
    return accepted;
  });
  const importThread = Effect.fn("HandoffImport.importThread")((input: Input) =>
    locks.withLock("imports", acceptThread(input)),
  );
  return HandoffImport.of({ importThread });
});
export const layer = Layer.effect(HandoffImport, make);
