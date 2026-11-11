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

const make = Effect.gen(function* () {
  const imports = yield* ThreadImportService.ThreadImportService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* HandoffGit.HandoffGit;
  const providers = yield* Providers.ProviderRegistry;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

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
      return { worktreePath: cwd, branch };
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
      if (saved === identity) return yield* boundWorkspace;
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
    yield* git
      .apply({
        repoRoot: project.value.workspaceRoot,
        worktreePath,
        handoffId: input.source.handoffId,
        bundlePath,
        branch,
        tip: bundle.tip,
        snapshot: bundle.snapshot,
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
    yield* fs.writeFileString(marker, identity).pipe(
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

  const importThread = Effect.fn("HandoffImport.importThread")(function* (input: Input) {
    return yield* imports
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
  });
  return HandoffImport.of({ importThread });
});
export const layer = Layer.effect(HandoffImport, make);
