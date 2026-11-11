import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";
import { removeLinkedWorktree } from "../../vcs/worktreeRemoval.ts";
import { MoveWorkspace } from "./MoveWorkspace.ts";
import { moveRetirementCaptureReason } from "./moveRetirementCapture.ts";

const decodeWorkspace = Schema.decodeUnknownEffect(Schema.fromJsonString(MoveWorkspace));

export const retireMoveWorkspace = Effect.fn("MoveRetirement.retireWorkspace")(
  function* <E, R>(thread: OrchestrationV2AppThread, guard: Effect.Effect<string | null, E, R>) {
    const handoff = thread.handoff;
    if (handoff?.state !== "departed" || !handoff.retirement) return null;
    const capture = handoff.retirement;
    const keep = (reason: string) => ({ ...capture, status: "kept" as const, reason });
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const id = thread.importOrigin?.handoffId;
    if (!id || !/^[a-zA-Z0-9-]{1,128}$/.test(id))
      return keep(
        "This source was not created as a disposable move workspace. Its checkout and branches were kept.",
      );
    const marker = path.join(config.stateDir, "thread-move-workspaces", `${id}.json`);
    const encoded = yield* fs.readFileString(marker);
    const owned = yield* decodeWorkspace(encoded);
    const root = capture.root;
    const managed = yield* fs.realPath(path.join(config.worktreesDir, "moves"));
    if (
      owned.source.handoffId !== id ||
      owned.branch !== thread.branch ||
      owned.source.environmentId !== thread.importOrigin?.environmentId ||
      owned.source.threadId !== thread.importOrigin.threadId ||
      root !== owned.root ||
      thread.worktreePath !== root ||
      path.join(managed, id) !== root
    )
      return keep(
        "The move workspace binding changed or uses a subdirectory. Its files were kept.",
      );
    if (owned.inode === "" || owned.adminInode === "")
      return keep("This filesystem cannot prove workspace identity.");
    const run = (cwd: string, args: ReadonlyArray<string>) =>
      git.execute({ operation: "MoveRetirement.remove", cwd, args });
    const intent = path.join(config.stateDir, "thread-move-workspaces", `${id}.retiring.json`);
    return yield* withWorkspaceLease(
      root,
      Effect.gen(function* () {
        const blocked = yield* guard;
        if (blocked) return keep(blocked);
        const exists = yield* fs.exists(root);
        if (exists) {
          const info = yield* fs.lstat(root);
          const admin = yield* fs.lstat(owned.gitDir);
          if (
            info.type !== "Directory" ||
            admin.type !== "Directory" ||
            String(info.dev) !== owned.device ||
            Option.getOrElse(Option.map(info.ino, String), () => "") !== owned.inode ||
            String(admin.dev) !== owned.adminDevice ||
            Option.getOrElse(Option.map(admin.ino, String), () => "") !== owned.adminInode ||
            (yield* fs.realPath(root)) !== root ||
            (yield* fs.lstat(path.join(root, ".git"))).type !== "File"
          )
            return keep("The original workspace was replaced. The current directory was kept.");
          if (
            (yield* run(root, ["rev-parse", "--absolute-git-dir"])).stdout.trim() !==
              owned.gitDir ||
            (yield* run(root, ["symbolic-ref", "HEAD"])).stdout.trim() !==
              `refs/heads/${owned.branch}`
          )
            return keep("The Git worktree identity changed. Its files were kept.");
          const common = (yield* run(root, [
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ])).stdout.trim();
          if (path.dirname(owned.gitDir) !== path.join(common, "worktrees"))
            return keep("The worktree registration changed.");
          const incoming = (yield* run(root, [
            "rev-parse",
            "--verify",
            owned.incomingRef,
          ])).stdout.trim();
          if (incoming !== owned.snapshot)
            return keep("The original incoming recovery version needs attention.");
          const reason = yield* moveRetirementCaptureReason(
            root,
            capture.tip,
            capture.snapshot,
            owned.provenance,
          );
          if (reason) return keep(reason);
          yield* fs.writeFileString(`${intent}.tmp`, encoded, { mode: 0o600 });
          yield* fs.rename(`${intent}.tmp`, intent);
          const finalBlocked = yield* guard;
          if (finalBlocked) return keep(finalBlocked);
          const finalReason = yield* moveRetirementCaptureReason(
            root,
            capture.tip,
            capture.snapshot,
            owned.provenance,
          );
          if (finalReason) return keep(finalReason);
          const finalInfo = yield* fs.lstat(root);
          const finalAdmin = yield* fs.lstat(owned.gitDir);
          if (
            String(finalInfo.dev) !== owned.device ||
            Option.getOrElse(Option.map(finalInfo.ino, String), () => "") !== owned.inode ||
            String(finalAdmin.dev) !== owned.adminDevice ||
            Option.getOrElse(Option.map(finalAdmin.ino, String), () => "") !== owned.adminInode
          )
            return keep(
              "The workspace was replaced during inspection. The current directory was kept.",
            );
          // Only newly allocated move checkouts are disposable; external writers must be stopped.
          yield* removeLinkedWorktree({
            operation: "MoveRetirement.remove",
            cwd: common,
            worktreePath: root,
            force: true,
            execute: git.execute,
            run: (args) => run(common, args),
          });
        } else if (
          (yield* fs.readFileString(intent).pipe(Effect.orElseSucceed(() => ""))) !== encoded
        ) {
          return keep(
            "The source directory is missing without a recorded removal. No references were removed.",
          );
        }
        const common = path.dirname(path.dirname(owned.gitDir));
        const listed = (yield* run(common, ["worktree", "list", "--porcelain"])).stdout;
        if (
          listed.split("\n").includes(`worktree ${root}`) ||
          listed.split("\n").includes(`branch refs/heads/${owned.branch}`)
        )
          return {
            ...capture,
            status: "removed" as const,
            reason: "The disposable checkout was removed; a registered branch was kept.",
          };
        const symbolic = yield* run(common, [
          "symbolic-ref",
          "--quiet",
          `refs/heads/${owned.branch}`,
        ]).pipe(Effect.option);
        const deleted =
          Option.isNone(symbolic) &&
          (yield* run(common, [
            "update-ref",
            "--no-deref",
            "-d",
            `refs/heads/${owned.branch}`,
            capture.tip,
          ]).pipe(Effect.result))._tag === "Success";
        if (!deleted)
          return {
            ...capture,
            status: "removed" as const,
            reason: "The disposable checkout was removed. A changed or protected branch was kept.",
          };
        return {
          ...capture,
          status: "removed" as const,
          reason:
            "The disposable source checkout and its owned branch were removed. Incoming recovery history remains available.",
        };
      }),
    );
  },
  (effect, thread) =>
    effect.pipe(
      Effect.orElseSucceed(() =>
        thread.handoff?.state === "departed" && thread.handoff.retirement
          ? {
              ...thread.handoff.retirement,
              status: "kept" as const,
              reason:
                "Cleanup could not prove the source safe to remove. Its remaining files and references were kept.",
            }
          : null,
      ),
    ),
);
