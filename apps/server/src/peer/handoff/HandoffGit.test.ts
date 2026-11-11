// @effect-diagnostics nodeBuiltinImport:off - FileSystem accepts only string paths; this fixture needs invalid UTF-8 bytes.
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as HandoffGit from "./HandoffGit.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { moveRetirementCaptureReason } from "./moveRetirementCapture.ts";
import { moveWorkspaceProvenance } from "./moveWorkspaceMetadata.ts";
import * as ServerConfig from "../../config.ts";
import * as HandoffImport from "./HandoffImport.ts";
import * as ThreadImportService from "../../orchestration-v2/ThreadImportService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderRegistryMock from "../../provider/testUtils/providerRegistryMock.ts";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { createPendingAttachmentId } from "../../attachmentStore.ts";

const layer = Layer.merge(HandoffGit.layer, GitVcsDriver.layer).pipe(
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "move-retirement-git-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);
const branch = "fix/login";
const setGitDir = (value: string | undefined) => {
  const before = process.env.GIT_DIR;
  if (value === undefined) delete process.env.GIT_DIR;
  else process.env.GIT_DIR = value;
  return before;
};
const handoffId = "transfer";

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const processes = yield* VcsProcess.VcsProcess;
  const result = yield* processes.run({
    operation: "HandoffGit.test",
    command: "git",
    cwd,
    args,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  return result.stdout.trimEnd();
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-handoff-git-" });
  const origin = path.join(root, "origin.git");
  const sender = path.join(root, "sender");
  const receiver = path.join(root, "receiver");
  const outDir = path.join(root, "out");
  yield* git(root, ["init", "--bare", "--initial-branch=main", origin]);
  yield* git(root, ["clone", origin, sender]);
  yield* fs.writeFileString(path.join(sender, "app.ts"), "initial\n");
  yield* fs.writeFileString(path.join(sender, "old.ts"), "delete me\n");
  yield* fs.writeFileString(path.join(sender, "settings.txt"), "public configuration\n");
  yield* fs.writeFileString(path.join(sender, "local.cfg"), "shared configuration\n");
  yield* fs.writeFileString(path.join(sender, ".gitignore"), ".env\n*.local\n");
  yield* git(sender, ["add", "."]);
  yield* git(sender, ["commit", "-m", "base"]);
  yield* git(sender, ["push", "origin", "main"]);
  yield* git(root, ["clone", origin, receiver]);
  yield* fs.makeDirectory(outDir);
  return { fs, path, origin, sender, receiver, outDir, worktree: path.join(root, "received") };
});

const editSender = Effect.fnUntraced(function* (sender: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* git(sender, ["checkout", "-b", branch]);
  yield* fs.writeFileString(path.join(sender, "app.ts"), "unpushed\n");
  yield* git(sender, ["commit", "-am", "unpushed"]);
  yield* fs.writeFileString(path.join(sender, "app.ts"), "staged\n");
  yield* git(sender, ["add", "app.ts"]);
  yield* fs.writeFileString(path.join(sender, "app.ts"), "unstaged\n");
  yield* fs.remove(path.join(sender, "old.ts"));
  yield* fs.makeDirectory(path.join(sender, "sub"));
  yield* fs.writeFileString(path.join(sender, "sub", "new.ts"), "untracked\n");
  yield* fs.writeFileString(path.join(sender, ".env"), "SECRET=private\n");
  yield* fs.writeFileString(path.join(sender, "conf.local"), "force-staged work\n");
  yield* git(sender, ["add", "-f", "conf.local"]);
  yield* git(sender, ["rm", "--cached", "settings.txt"]);
  yield* fs.writeFileString(path.join(sender, ".gitignore"), ".env\n*.local\nsettings.txt\n");
  yield* fs.writeFileString(path.join(sender, "settings.txt"), "private configuration\n");
});

const repositoryState = Effect.fnUntraced(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const status = yield* git(cwd, ["status", "--porcelain"]);
  const gitDir = yield* git(cwd, ["rev-parse", "--absolute-git-dir"]);
  return {
    status,
    head: yield* git(cwd, ["rev-parse", "HEAD"]),
    refs: yield* git(cwd, ["show-ref"]),
    index: yield* fs.readFile(path.join(gitDir, "index")),
    indexFiles: (yield* fs.readDirectory(gitDir)).filter((name) => name.includes("index")).sort(),
  };
});

const applyInput = (repo: Effect.Success<typeof fixture>, packed: HandoffGit.HandoffPackage) => ({
  ...packed,
  handoffId,
  repoRoot: repo.receiver,
  worktreePath: repo.worktree,
});

// Real Git performs every mutation; the gate exposes a deterministic cancellation boundary.
const pauseGit = Effect.fnUntraced(function* (
  matches: (input: VcsProcess.VcsProcessInput) => boolean,
  timing: "before" | "after" = "before",
) {
  const processes = yield* VcsProcess.VcsProcess;
  const reached = yield* Deferred.make<void>();
  const handoff = yield* HandoffGit.HandoffGit.pipe(
    Effect.provide(Layer.fresh(HandoffGit.layer)),
    Effect.provideService(VcsProcess.VcsProcess, {
      run: (input) => {
        const run = processes.run(input);
        if (!matches(input)) return run;
        const pause = Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never));
        return timing === "before"
          ? pause.pipe(Effect.andThen(run))
          : run.pipe(Effect.tap(() => pause));
      },
    }),
  );
  return { handoff, reached };
});

it.layer(layer)("Git bundle pack/apply", (it) => {
  it.effect("never borrows an existing same-tip branch as a disposable move branch", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const handoff = yield* HandoffGit.HandoffGit;
      const packed = yield* handoff.pack({ cwd: repo.sender, handoffId, outDir: repo.outDir });
      yield* git(repo.receiver, ["branch", "move/owned"]);
      const before = yield* repositoryState(repo.receiver);
      const error = yield* handoff
        .apply({ ...applyInput(repo, packed), branch: "move/owned", ownWorkspace: true })
        .pipe(Effect.flip);
      assert.include(error.message, "already in use");
      assert.deepEqual(yield* repositoryState(repo.receiver), before);
      assert.isFalse(yield* repo.fs.exists(repo.worktree));
    }).pipe(Effect.scoped),
  );
  it.effect.each(["blank", "continuation", "quota"])(
    "replays an accepted %s import after workspace, provider and project disappear",
    (mode) =>
      Effect.gen(function* () {
        const repo = yield* fixture;
        const config = yield* ServerConfig.ServerConfig;
        const handoff = yield* HandoffGit.HandoffGit;
        const id = `receipt-${mode}`;
        yield* repo.fs.writeFileString(
          repo.path.join(repo.sender, "app.ts"),
          "original incoming bytes\n",
        );
        const packed = yield* handoff.pack({
          cwd: repo.sender,
          handoffId: id,
          outDir: repo.outDir,
        });
        const attachmentId = createPendingAttachmentId("bundle");
        const upload = repo.path.join(config.attachmentsDir, `${attachmentId}.bundle`);
        assert.isNotNull(upload);
        yield* repo.fs.makeDirectory(repo.path.dirname(upload!), { recursive: true });
        yield* repo.fs.copyFile(packed.bundlePath, upload!);
        const projectId = ProjectId.make(`receipt-project-${mode}`);
        const input = {
          source: {
            environmentId: EnvironmentId.make("source"),
            threadId: ThreadId.make("source"),
            handoffId: id,
          },
          projectId,
          title: "Moved",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          linkOrigin: { sessionId: "original-session", label: "Source" },
          messages: [],
          bundle: { attachmentId, tip: packed.tip, snapshot: packed.snapshot, relativeCwd: "" },
          ...(mode === "continuation" ? { continuationPrompt: "Continue" } : {}),
        };
        let calls = 0;
        let available = true;
        const processes = yield* VcsProcess.VcsProcess;
        if (mode === "quota")
          yield* processes.run({
            operation: "HandoffGit.testQuota",
            command: "git",
            cwd: repo.receiver,
            args: ["update-ref", "--stdin"],
            stdin: Array.from(
              { length: 256 },
              (_, index) => `create refs/t3code/moves/saved-${index}/incoming ${packed.tip}\n`,
            ).join(""),
          });
        const native = Layer.mock(ThreadImportService.ThreadImportService)({
          importThread: (request) =>
            Effect.gen(function* () {
              assert.isTrue(available);
              const workspace = yield* request.workspace!;
              calls++;
              assert.equal(
                yield* git(repo.receiver, ["show", `refs/t3code/moves/${id}/incoming:app.ts`]).pipe(
                  Effect.provideService(VcsProcess.VcsProcess, processes),
                  Effect.orDie,
                ),
                "original incoming bytes",
              );
              yield* repo.fs
                .writeFileString(
                  repo.path.join(workspace.worktreePath, "app.ts"),
                  "setup replaced incoming bytes\n",
                )
                .pipe(Effect.orDie);
              return {
                threadId: ThreadId.make(`accepted-${mode}`),
                projectId,
                created: true,
                runId: mode === "continuation" ? RunId.make("original-run") : null,
              };
            }),
        });
        const dependencies = Layer.mergeAll(
          native,
          Layer.mock(ProjectService.ProjectService)({
            getById: () =>
              available
                ? Effect.succeedSome({ id: projectId, workspaceRoot: repo.receiver } as never)
                : Effect.die("A replay must not look up a project"),
          }),
          ProviderRegistryMock.layer([
            {
              instanceId: input.modelSelection.instanceId,
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              installed: true,
              version: null,
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-11-11T00:00:00Z",
              models: [],
              slashCommands: [],
              skills: [],
            },
          ]),
        );
        const imports = yield* HandoffImport.HandoffImport.pipe(
          Effect.provide(HandoffImport.layer.pipe(Layer.provide(dependencies))),
        );
        if (mode === "quota") {
          const refused = yield* imports.importThread(input).pipe(Effect.flip);
          assert.include(refused.message, "256 incoming recovery versions");
          assert.equal(calls, 0);
          assert.isFalse(yield* repo.fs.exists(repo.path.join(config.worktreesDir, "moves", id)));
          assert.equal(
            (yield* git(repo.receiver, [
              "for-each-ref",
              "--format=%(refname)",
              "refs/t3code/moves/",
            ])).split("\n").length,
            256,
          );
          return;
        }
        const first = yield* imports.importThread(input);
        assert.equal(first.incomingSnapshot?.snapshot, packed.snapshot);
        assert.isFalse(yield* repo.fs.exists(upload!));
        available = false;
        yield* git(repo.receiver, [
          "worktree",
          "remove",
          "--force",
          repo.path.join(config.worktreesDir, "moves", id),
        ]);
        const replay = yield* imports.importThread({
          ...input,
          bundle: { ...input.bundle, attachmentId: "pending" },
        });
        assert.deepEqual(replay, { ...first, created: false });
        assert.equal(calls, 1);
        const mismatch = yield* imports
          .importThread({
            ...input,
            linkOrigin: { sessionId: "different-session", label: "Source" },
          })
          .pipe(Effect.result);
        assert.equal(mismatch._tag, "Failure");
        assert.equal(calls, 1);
        yield* git(repo.receiver, ["gc", "--prune=now"]);
        assert.equal(
          yield* git(repo.receiver, ["show", `${first.incomingSnapshot!.ref}:app.ts`]),
          "original incoming bytes",
        );
      }).pipe(Effect.scoped),
  );
  it.effect(
    "retains the exact incoming version through setup overwrites and garbage collection",
    () =>
      Effect.gen(function* () {
        const repo = yield* fixture;
        const handoff = yield* HandoffGit.HandoffGit;
        yield* repo.fs.writeFileString(
          repo.path.join(repo.sender, "app.ts"),
          "incoming unique work\n",
        );
        const packed = yield* handoff.pack({ cwd: repo.sender, handoffId, outDir: repo.outDir });
        yield* handoff.apply({
          ...applyInput(repo, packed),
          branch: "move/transfer",
          ownWorkspace: true,
        });
        yield* repo.fs.writeFileString(
          repo.path.join(repo.worktree, "app.ts"),
          "setup overwrote this\n",
        );
        yield* git(repo.receiver, ["gc", "--prune=now"]);
        assert.equal(
          yield* git(repo.receiver, ["show", "refs/t3code/moves/transfer/incoming:app.ts"]),
          "incoming unique work",
        );
        yield* repo.fs.remove(packed.bundlePath);
        assert.equal(
          yield* git(repo.receiver, ["rev-parse", "refs/t3code/moves/transfer/incoming"]),
          packed.snapshot,
        );
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    "portable",
    "staged-only",
    "ignored",
    "changed after capture",
    "assume unchanged",
    "intent to add",
    "filter",
  ])("only certifies lossless source retirement: %s", (mode) =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const handoff = yield* HandoffGit.HandoffGit;
      yield* repo.fs.writeFileString(
        repo.path.join(repo.sender, "app.ts"),
        "ordinary working edit\n",
      );
      yield* repo.fs.writeFileString(repo.path.join(repo.sender, "new.txt"), "new portable file\n");
      if (mode === "staged-only") {
        yield* git(repo.sender, ["add", "app.ts"]);
        yield* repo.fs.writeFileString(
          repo.path.join(repo.sender, "app.ts"),
          "another working version\n",
        );
      }
      if (mode === "ignored")
        yield* repo.fs.writeFileString(repo.path.join(repo.sender, ".env"), "PRIVATE=local\n");
      if (mode === "assume unchanged")
        yield* git(repo.sender, ["update-index", "--assume-unchanged", "local.cfg"]);
      if (mode === "intent to add") yield* git(repo.sender, ["add", "--intent-to-add", "new.txt"]);
      if (mode === "filter") {
        yield* repo.fs.writeFileString(
          repo.path.join(repo.sender, ".gitattributes"),
          "app.ts text eol=crlf\n",
        );
        yield* repo.fs.writeFileString(repo.path.join(repo.sender, "app.ts"), "raw CRLF\r\n");
      }
      const packed = yield* handoff.pack({ cwd: repo.sender, handoffId, outDir: repo.outDir });
      if (mode === "changed after capture")
        yield* repo.fs.writeFileString(repo.path.join(repo.sender, "app.ts"), "late work\n");
      const before = yield* repositoryState(repo.sender);
      const reason = yield* moveRetirementCaptureReason(
        repo.sender,
        packed.tip,
        packed.snapshot,
        yield* moveWorkspaceProvenance(repo.sender),
      );
      if (mode === "portable") assert.isNull(reason);
      else assert.isNotNull(reason);
      assert.deepEqual(yield* repositoryState(repo.sender), before);
      if (mode === "ignored")
        assert.equal(
          yield* repo.fs.readFileString(repo.path.join(repo.sender, ".env")),
          "PRIVATE=local\n",
        );
    }).pipe(Effect.scoped),
  );
  it.effect.each(["branch", "detached subdirectory", "sparse checkout", "sparse receiver"])(
    "round-trips %s without changing either existing checkout",
    (mode) =>
      Effect.gen(function* () {
        const repo = yield* fixture;
        const { path, fs, sender, receiver, outDir, worktree } = repo;
        const handoff = yield* HandoffGit.HandoffGit;
        if (mode === "sparse checkout" || mode === "sparse receiver") {
          yield* fs.makeDirectory(path.join(sender, "excluded"));
          yield* fs.writeFileString(path.join(sender, "excluded", "file"), "outside cone\n");
          yield* fs.writeFileString(path.join(sender, "excluded", "gone"), "delete outside cone\n");
          yield* git(sender, ["add", "."]);
          yield* git(sender, ["commit", "-m", "outside cone"]);
        }
        yield* editSender(sender);
        if (mode === "sparse receiver") yield* fs.remove(path.join(sender, "excluded", "gone"));
        yield* git(sender, ["tag", branch]);
        if (mode === "detached subdirectory") yield* git(sender, ["checkout", "--detach"]);
        if (mode === "sparse checkout") {
          yield* git(sender, ["sparse-checkout", "set", "sub"]);
          yield* fs.makeDirectory(path.join(sender, "excluded"), { recursive: true });
          yield* fs.writeFileString(path.join(sender, "excluded", "new.txt"), "outside work\n");
        }
        if (mode !== "sparse checkout") {
          yield* git(sender, ["update-index", "--skip-worktree", "local.cfg"]);
          yield* fs.writeFileString(
            path.join(sender, "local.cfg"),
            "hidden private configuration\n",
          );
        }
        if (mode === "branch") {
          yield* git(sender, ["config", "core.splitIndex", "true"]);
          yield* git(sender, ["config", "splitIndex.sharedIndexExpire", "now"]);
          yield* git(sender, ["update-index", "--split-index"]);
        }
        yield* fs.writeFileString(path.join(receiver, "app.ts"), "receiver work\n");
        if (mode === "sparse checkout" || mode === "sparse receiver")
          yield* git(receiver, ["sparse-checkout", "set", "sub"]);
        const senderBefore = yield* repositoryState(sender);
        const receiverBefore = yield* repositoryState(receiver);
        // A server launched by a Git hook can inherit another checkout's GIT_DIR.
        const packed = yield* Effect.scoped(
          Effect.gen(function* () {
            const gitDir = yield* git(receiver, ["rev-parse", "--absolute-git-dir"]);
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                return setGitDir(gitDir);
              }),
              (before) =>
                Effect.sync(() => {
                  setGitDir(before);
                }),
            );
            return yield* handoff.pack({
              cwd: mode === "detached subdirectory" ? path.join(sender, "sub") : sender,
              handoffId,
              outDir,
            });
          }),
        );
        assert.deepEqual(yield* repositoryState(sender), senderBefore);
        assert.equal(packed.branch, mode === "detached subdirectory" ? null : branch);
        yield* handoff.apply(applyInput(repo, packed));
        assert.equal(yield* git(worktree, ["rev-parse", "HEAD"]), senderBefore.head);
        assert.equal(yield* git(worktree, ["show", "HEAD:app.ts"]), "unpushed");
        assert.equal(yield* fs.readFileString(path.join(worktree, "app.ts")), "unstaged\n");
        assert.equal(yield* fs.readFileString(path.join(worktree, "sub", "new.ts")), "untracked\n");
        assert.isFalse(yield* fs.exists(path.join(worktree, "old.ts")));
        assert.isFalse(yield* fs.exists(path.join(worktree, ".env")));
        assert.equal(
          yield* fs.readFileString(path.join(worktree, "local.cfg")),
          "shared configuration\n",
        );
        assert.isFalse(yield* fs.exists(path.join(worktree, "settings.txt")));
        if (mode === "sparse checkout" || mode === "sparse receiver") {
          assert.equal(
            yield* git(worktree, ["show", `${packed.snapshot}:excluded/file`]),
            "outside cone",
          );
        }
        if (mode === "sparse checkout")
          assert.equal(
            yield* fs.readFileString(path.join(worktree, "excluded", "new.txt")),
            "outside work\n",
          );
        assert.equal(
          yield* fs.readFileString(path.join(worktree, "conf.local")),
          "force-staged work\n",
        );
        assert.equal(
          yield* git(worktree, ["status", "--porcelain"]),
          mode === "sparse receiver"
            ? " M .gitignore\n M app.ts\n D excluded/gone\n D old.ts\n D settings.txt\n?? sub/"
            : mode === "sparse checkout"
              ? " M .gitignore\n M app.ts\n D old.ts\n D settings.txt\n?? excluded/new.txt\n?? sub/"
              : " M .gitignore\n M app.ts\n D old.ts\n D settings.txt\n?? sub/",
        );
        const receiverAfter = yield* repositoryState(receiver);
        assert.deepEqual({ ...receiverAfter, refs: receiverBefore.refs }, receiverBefore);
        assert.equal(yield* fs.readFileString(path.join(receiver, "app.ts")), "receiver work\n");
        assert.equal(yield* git(receiver, ["for-each-ref", "refs/t3code"]), "");
      }).pipe(Effect.scoped),
  );

  it.effect.each(["unused behind", "diverged", "checked out behind", "checked out at tip"])(
    "handles a receiver branch that is %s",
    (mode) =>
      Effect.gen(function* () {
        const repo = yield* fixture;
        const { path, sender, receiver, outDir, worktree, fs } = repo;
        const handoff = yield* HandoffGit.HandoffGit;
        yield* editSender(sender);
        const packed = yield* handoff.pack({ cwd: sender, handoffId, outDir });
        if (mode === "checked out at tip")
          yield* git(receiver, ["fetch", sender, `${branch}:${branch}`]);
        else yield* git(receiver, ["branch", branch]);
        if (mode !== "unused behind") yield* git(receiver, ["checkout", branch]);
        if (mode === "diverged") {
          yield* git(receiver, ["commit", "--allow-empty", "-m", "receiver only"]);
          yield* git(receiver, ["checkout", "main"]);
        }
        const before = yield* repositoryState(receiver);
        const worktrees = yield* git(receiver, ["worktree", "list", "--porcelain"]);
        const apply = handoff.apply(applyInput(repo, packed));
        if (mode === "diverged" || mode === "checked out behind") {
          const error = yield* apply.pipe(Effect.flip);
          assert.equal(
            error._tag,
            mode === "diverged" ? "HandoffBranchDivergedError" : "HandoffBranchCheckedOutError",
          );
          assert.deepEqual(yield* repositoryState(receiver), before);
          assert.equal(yield* git(receiver, ["worktree", "list", "--porcelain"]), worktrees);
          assert.isFalse(yield* fs.exists(worktree));
        } else {
          assert.equal((yield* apply).branch, mode === "unused behind" ? branch : null);
          assert.equal(yield* git(receiver, ["rev-parse", branch]), packed.tip);
          assert.equal(yield* git(worktree, ["rev-parse", "HEAD"]), packed.tip);
          assert.equal(yield* fs.readFileString(path.join(worktree, "app.ts")), "unstaged\n");
        }
        assert.equal(yield* git(receiver, ["for-each-ref", "refs/t3code"]), "");
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    "new branch",
    "fast-forward",
    "concurrent branch move",
    "successful concurrent branch move",
  ])("rolls back an invalid checkout: %s", (mode) =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const { path, fs, sender, receiver, outDir, worktree } = repo;
      const handoff = yield* HandoffGit.HandoffGit;
      yield* editSender(sender);
      const packed = yield* handoff.pack({ cwd: sender, handoffId, outDir });
      if (mode === "fast-forward") yield* git(receiver, ["branch", branch]);
      const before = yield* git(receiver, ["show-ref"]);
      const worktrees = yield* git(receiver, ["worktree", "list", "--porcelain"]);
      if (mode === "fast-forward") {
        yield* fs.makeDirectory(worktree);
        yield* fs.writeFileString(path.join(worktree, "keep.txt"), "existing work\n");
        const error = yield* handoff.apply(applyInput(repo, packed)).pipe(Effect.flip);
        assert.equal(error._tag, "HandoffGitStepError");
        assert.equal(yield* git(receiver, ["show-ref"]), before);
        assert.equal(yield* git(receiver, ["worktree", "list", "--porcelain"]), worktrees);
        assert.equal(yield* fs.readFileString(path.join(worktree, "keep.txt")), "existing work\n");
        yield* fs.remove(worktree, { recursive: true });
      }
      const moved = yield* git(receiver, ["rev-parse", "main"]);
      const hook = path.join(receiver, ".git", "hooks", "post-checkout");
      yield* fs.writeFileString(
        hook,
        `#!/bin/sh\n${mode.includes("concurrent branch move") ? `git update-ref refs/heads/${branch} ${moved}\n` : ""}exit ${mode === "successful concurrent branch move" ? 0 : 1}\n`,
      );
      yield* fs.chmod(hook, 0o755);
      const error = yield* handoff.apply(applyInput(repo, packed)).pipe(Effect.flip);
      assert.equal(error._tag, "HandoffGitStepError");
      if (mode.includes("concurrent branch move"))
        assert.equal(yield* git(receiver, ["rev-parse", branch]), moved);
      else assert.equal(yield* git(receiver, ["show-ref"]), before);
      assert.equal(yield* git(receiver, ["for-each-ref", "refs/t3code"]), "");
      assert.equal(yield* git(receiver, ["worktree", "list", "--porcelain"]), worktrees);
      assert.isFalse(yield* fs.exists(worktree));
    }).pipe(Effect.scoped),
  );

  it.effect.each(["new branch", "fast-forward"])("rolls back a cancelled apply: %s", (mode) =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const { path, sender, receiver, outDir, worktree, fs } = repo;
      yield* editSender(sender);
      if (mode === "fast-forward") yield* git(receiver, ["branch", branch]);
      const before = yield* repositoryState(receiver);
      const worktrees = yield* git(receiver, ["worktree", "list", "--porcelain"]);
      const { handoff, reached } = yield* pauseGit(
        (input) => input.cwd === worktree && input.args[0] === "checkout",
      );
      const packed = yield* handoff.pack({ cwd: sender, handoffId, outDir });
      const fiber = yield* handoff.apply(applyInput(repo, packed)).pipe(Effect.forkScoped);
      yield* Deferred.await(reached);
      assert.isTrue(yield* fs.exists(path.join(worktree, ".git")));
      yield* Fiber.interrupt(fiber);
      assert.deepEqual(
        {
          repository: yield* repositoryState(receiver),
          worktrees: yield* git(receiver, ["worktree", "list", "--porcelain"]),
          worktreeExists: yield* fs.exists(worktree),
        },
        { repository: before, worktrees, worktreeExists: false },
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each(["existing origin", "no origin", "fork remote"])(
    "resolves a missing bundle base with %s",
    (mode) =>
      Effect.gen(function* () {
        const repo = yield* fixture;
        const { path, sender, receiver, origin, outDir, worktree, fs } = repo;
        const handoff = yield* HandoffGit.HandoffGit;
        yield* fs.writeFileString(path.join(sender, "later.ts"), "pushed later\n");
        yield* git(sender, ["add", "."]);
        yield* git(sender, ["commit", "-m", "later base"]);
        if (mode === "fork remote") {
          const fork = path.join(path.dirname(sender), "fork.git");
          yield* git(sender, ["clone", "--bare", origin, fork]);
          yield* git(sender, ["remote", "add", "fork", fork]);
        }
        yield* git(sender, ["push", mode === "fork remote" ? "fork" : "origin", "main"]);
        yield* editSender(sender);
        const packed = yield* handoff.pack({ cwd: sender, handoffId, outDir });
        const processes = yield* VcsProcess.VcsProcess;
        assert.equal(
          (yield* processes.run({
            operation: "test.verify",
            command: "git",
            cwd: receiver,
            args: ["bundle", "verify", packed.bundlePath],
            allowNonZeroExit: true,
          })).exitCode === 0,
          mode === "fork remote",
        );
        if (mode === "no origin") {
          yield* git(receiver, ["remote", "remove", "origin"]);
          yield* git(receiver, ["remote", "add", "other", origin]);
          const before = yield* repositoryState(receiver);
          const error = yield* handoff.apply(applyInput(repo, packed)).pipe(Effect.flip);
          assert.equal(error._tag, "HandoffMissingBaseError");
          assert.deepEqual(yield* repositoryState(receiver), before);
          assert.isFalse(yield* fs.exists(worktree));
        } else {
          yield* handoff.apply(applyInput(repo, packed));
          assert.equal(yield* fs.readFileString(path.join(worktree, "later.ts")), "pushed later\n");
        }
      }).pipe(Effect.scoped),
  );

  it.effect("refuses a changing workspace while preserving the writer's files and staging", () =>
    Effect.gen(function* () {
      const { fs, path, sender, outDir } = yield* fixture;
      yield* editSender(sender);
      const indexBefore = yield* git(sender, ["diff", "--cached"]);
      const processes = yield* VcsProcess.VcsProcess;
      const handoff = yield* HandoffGit.HandoffGit.pipe(
        Effect.provide(Layer.fresh(HandoffGit.layer)),
        Effect.provideService(VcsProcess.VcsProcess, {
          run: (input) =>
            processes
              .run(input)
              .pipe(
                Effect.tap(() =>
                  input.args[0] === "bundle" && input.args[1] === "create"
                    ? fs
                        .writeFileString(path.join(sender, "app.ts"), "concurrent writer\n")
                        .pipe(Effect.orDie)
                    : Effect.void,
                ),
              ),
        }),
      );
      const error = yield* handoff.pack({ cwd: sender, handoffId, outDir }).pipe(Effect.flip);
      assert.equal(error._tag, "HandoffGitStepError");
      assert.include(error.message, "workspace changed");
      assert.equal(yield* git(sender, ["diff", "--cached"]), indexBefore);
      assert.equal(yield* fs.readFileString(path.join(sender, "app.ts")), "concurrent writer\n");
      assert.deepEqual(yield* fs.readDirectory(outDir), []);
    }).pipe(Effect.scoped),
  );

  it.effect.each(["submodule", "nested repository"])("refuses omitted work in a %s", (kind) =>
    Effect.gen(function* () {
      const { path, fs, sender, origin, outDir } = yield* fixture;
      const handoff = yield* HandoffGit.HandoffGit;
      const nested = path.join(sender, "nested");
      if (kind === "submodule") {
        yield* git(sender, [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          origin,
          "nested",
        ]);
        yield* git(sender, ["commit", "-am", "submodule"]);
      } else {
        yield* git(sender, ["clone", origin, nested]);
      }
      yield* fs.writeFileString(path.join(nested, "app.ts"), "uncommitted nested work\n");
      const cwd = path.join(sender, "subdirectory");
      yield* fs.makeDirectory(cwd);
      const before = yield* repositoryState(sender);
      const error = yield* handoff.pack({ cwd, handoffId, outDir }).pipe(Effect.flip);
      assert.equal(error._tag, "HandoffGitStepError");
      assert.include(error.message, "does not carry submodules or nested repositories");
      assert.deepEqual(yield* repositoryState(sender), before);
      assert.deepEqual(yield* fs.readDirectory(outDir), []);
      assert.equal(
        yield* fs.readFileString(path.join(nested, "app.ts")),
        "uncommitted nested work\n",
      );
    }).pipe(Effect.scoped),
  );

  // quarantine: #22020 Invalid UTF-8 filenames require the Linux filesystem fixture.
  it.effect.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
    "refuses invalid UTF-8 force-staged names",
    () =>
      Effect.gen(function* () {
        const { sender, outDir, fs } = yield* fixture;
        const handoff = yield* HandoffGit.HandoffGit;
        const name = Buffer.concat([
          Buffer.from(`${sender}/`),
          Buffer.from([0xff]),
          Buffer.from(".local"),
        ]);
        yield* Effect.promise(() => NodeFSP.writeFile(name, "staged work\n"));
        yield* git(sender, ["add", "-f", "--", ":/"]);
        const before = yield* repositoryState(sender);
        const error = yield* handoff.pack({ cwd: sender, handoffId, outDir }).pipe(Effect.flip);
        assert.equal(error._tag, "HandoffGitStepError");
        assert.include(error.message, "UTF-8");
        assert.deepEqual(yield* repositoryState(sender), before);
        assert.deepEqual(yield* fs.readDirectory(outDir), []);
        assert.equal(yield* Effect.promise(() => NodeFSP.readFile(name, "utf8")), "staged work\n");
      }).pipe(Effect.scoped),
  );

  it.effect("rejects an incompressible bundle over 50 MiB and removes its artifacts", () =>
    Effect.gen(function* () {
      const { path, fs, sender, outDir } = yield* fixture;
      const handoff = yield* HandoffGit.HandoffGit;
      const crypto = yield* SecureRandom.SecureRandom;
      yield* fs.writeFile(
        path.join(sender, "large.bin"),
        yield* crypto.randomBytes(50 * 1024 * 1024 + 1024),
      );
      const before = yield* repositoryState(sender);
      const error = yield* handoff.pack({ cwd: sender, handoffId, outDir }).pipe(Effect.flip);
      assert.equal(error._tag, "HandoffTooLargeError");
      assert.deepEqual(yield* fs.readDirectory(outDir), []);
      assert.deepEqual(yield* repositoryState(sender), before);
    }).pipe(Effect.scoped),
  );

  it.effect.each(["private index", "written bundle"])("cleans a cancelled pack at %s", (stage) =>
    Effect.gen(function* () {
      const { path, fs, sender, outDir } = yield* fixture;
      yield* editSender(sender);
      const before = yield* repositoryState(sender);
      const { handoff, reached } = yield* pauseGit(
        (input) =>
          stage === "private index"
            ? input.args[0] === "write-tree"
            : input.args[0] === "bundle" && input.args[1] === "create",
        stage === "private index" ? "before" : "after",
      );
      const fiber = yield* handoff.pack({ cwd: sender, handoffId, outDir }).pipe(Effect.forkScoped);
      yield* Deferred.await(reached);
      if (stage === "written bundle")
        assert.isTrue(yield* fs.exists(path.join(outDir, `${handoffId}.bundle`)));
      yield* Fiber.interrupt(fiber);
      assert.deepEqual(yield* repositoryState(sender), before);
      assert.deepEqual(yield* fs.readDirectory(outDir), []);
    }).pipe(Effect.scoped),
  );
});
