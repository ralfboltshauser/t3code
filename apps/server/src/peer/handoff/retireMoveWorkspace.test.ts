import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { liveThreadShell, idleThreadProjection } from "../../mcp/McpToolAccess.testkit.ts";
import * as HandoffGit from "./HandoffGit.ts";
import { MoveWorkspace } from "./MoveWorkspace.ts";
import { retireMoveWorkspace } from "./retireMoveWorkspace.ts";
import { moveWorkspaceProvenance } from "./moveWorkspaceMetadata.ts";
const encodeWorkspace = Schema.encodeEffect(Schema.fromJsonString(MoveWorkspace));

const layer = Layer.merge(HandoffGit.layer, GitVcsDriver.layer).pipe(
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "move-retirement-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const fixture = Effect.fn("MoveRetirement.testFixture")(function* (id: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const handoff = yield* HandoffGit.HandoffGit;
  const temporary = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "move-retirement-repo-" }),
  );
  const source = path.join(temporary, "source");
  const receiver = path.join(temporary, "receiver");
  const run = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({
      operation: "retirement-test",
      cwd,
      args: ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    });
  yield* run(temporary, ["init", "-b", "main", source]);
  yield* fs.writeFileString(path.join(source, "file.txt"), "committed\n");
  yield* fs.writeFileString(path.join(source, ".gitignore"), ".env\n");
  yield* run(source, ["add", "."]);
  yield* run(source, ["commit", "-m", "base"]);
  yield* run(temporary, ["clone", source, receiver]);
  yield* fs.writeFileString(path.join(source, "file.txt"), "received uncommitted work\n");
  const packed = yield* handoff.pack({ cwd: source, handoffId: id, outDir: temporary });
  const parent = path.join(config.worktreesDir, "moves");
  yield* fs.makeDirectory(parent, { recursive: true });
  const root = path.join(yield* fs.realPath(parent), id);
  const branch = `move/${id}`;
  yield* handoff.apply({
    repoRoot: receiver,
    worktreePath: root,
    handoffId: id,
    bundlePath: packed.bundlePath,
    branch,
    tip: packed.tip,
    snapshot: packed.snapshot,
    ownWorkspace: true,
  });
  const origin = {
    environmentId: EnvironmentId.make("first-host"),
    threadId: ThreadId.make("first-thread"),
    handoffId: id,
  };
  const info = yield* fs.stat(root);
  const gitDir = (yield* run(root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const admin = yield* fs.stat(gitDir);
  const marker = path.join(config.stateDir, "thread-move-workspaces", `${id}.json`);
  yield* fs.makeDirectory(path.dirname(marker), { recursive: true });
  yield* fs.writeFileString(
    marker,
    yield* encodeWorkspace({
      version: 1,
      identity: "test",
      source: origin,
      root,
      branch,
      tip: packed.tip,
      snapshot: packed.snapshot,
      incomingRef: `refs/t3code/moves/${id}/incoming`,
      gitDir,
      device: String(info.dev),
      inode: Option.getOrElse(Option.map(info.ino, String), () => ""),
      adminDevice: String(admin.dev),
      adminInode: Option.getOrElse(Option.map(admin.ino, String), () => ""),
      provenance: yield* moveWorkspaceProvenance(root),
    }),
  );
  const outgoing = yield* handoff.pack({
    cwd: root,
    handoffId: `outgoing-${id}`,
    outDir: temporary,
  });
  const thread = {
    ...idleThreadProjection(liveThreadShell(ThreadId.make(`thread-${id}`))).thread,
    branch,
    worktreePath: root,
    importOrigin: { ...origin, fingerprint: "test" },
    handoff: {
      state: "departed" as const,
      handoffId: `outgoing-${id}`,
      environmentId: EnvironmentId.make("next-host"),
      label: "Next host",
      threadId: ThreadId.make("next-thread"),
      retirement: {
        root,
        tip: outgoing.tip,
        snapshot: outgoing.snapshot,
        status: "pending" as const,
        reason: "Checking",
      },
    },
  };
  return { fs, path, root, branch, thread, outgoing, receiver, run, packed, marker, git };
});

it.layer(layer)("Disposable moved workspace retirement", (it) => {
  it.effect.each([
    "portable",
    "staged",
    "ignored",
    "other-owner",
    "late-write",
    "replacement",
    "legacy",
    "subdirectory",
    "permissions",
    "attributes",
  ])("%s retires only when every supported byte is preserved", (mode) =>
    Effect.gen(function* () {
      const repo = yield* fixture(mode);
      if (mode === "staged") {
        yield* repo.run(repo.root, ["add", "file.txt"]);
        yield* repo.fs.writeFileString(
          repo.path.join(repo.root, "file.txt"),
          "working differs from staging\n",
        );
      }
      if (mode === "ignored")
        yield* repo.fs.writeFileString(repo.path.join(repo.root, ".env"), "PRIVATE=keep\n");
      if (mode === "replacement") {
        yield* repo.fs.rename(repo.root, `${repo.root}-original`);
        yield* repo.fs.makeDirectory(repo.root);
        yield* repo.fs.writeFileString(
          repo.path.join(repo.root, "new-owner"),
          "keep replacement\n",
        );
      }
      if (mode === "permissions")
        yield* repo.fs.chmod(repo.path.join(repo.root, "file.txt"), 0o600);
      if (mode === "attributes") {
        const processes = yield* VcsProcess.VcsProcess;
        yield* processes.run({
          operation: "MoveRetirement.testAttribute",
          command: "python3",
          cwd: repo.root,
          args: [
            "-c",
            "import os,sys,subprocess; p=sys.argv[1]; subprocess.run(['/usr/bin/xattr','-w','t3-retirement-test','unique metadata',p],check=True) if sys.platform=='darwin' else os.setxattr(p,'user.t3-retirement-test',b'unique metadata')",
            repo.path.join(repo.root, "file.txt"),
          ],
        });
      }
      let checks = 0;
      const guard = Effect.gen(function* () {
        checks++;
        if (mode === "other-owner") return "Another thread owns this workspace.";
        if (mode === "late-write" && checks === 2)
          yield* repo.fs.writeFileString(
            repo.path.join(repo.root, "file.txt"),
            "late external edit\n",
          );
        return null;
      });
      const thread =
        mode === "legacy"
          ? { ...repo.thread, importOrigin: undefined }
          : mode === "subdirectory"
            ? { ...repo.thread, worktreePath: `${repo.root}/subdirectory` }
            : repo.thread;
      const result = yield* retireMoveWorkspace(thread, guard);
      assert.equal(result?.status, mode === "portable" ? "removed" : "kept", result?.reason);
      assert.equal(yield* repo.fs.exists(repo.root), mode !== "portable");
      if (mode === "portable") {
        assert.notInclude(
          (yield* repo.run(repo.receiver, ["for-each-ref", "--format=%(refname)", "refs/heads/"]))
            .stdout,
          `refs/heads/${repo.branch}`,
        );
        assert.equal(
          (yield* repo.run(repo.receiver, ["show", `refs/t3code/moves/${mode}/incoming:file.txt`]))
            .stdout,
          "received uncommitted work\n",
        );
        assert.equal((yield* retireMoveWorkspace(repo.thread, guard))?.status, "removed");
        yield* repo.fs.makeDirectory(repo.root);
        yield* repo.fs.writeFileString(
          repo.path.join(repo.root, "new-owner"),
          "replacement after removal\n",
        );
        assert.equal((yield* retireMoveWorkspace(repo.thread, guard))?.status, "kept");
        assert.equal(
          yield* repo.fs.readFileString(repo.path.join(repo.root, "new-owner")),
          "replacement after removal\n",
        );
      }
      if (mode === "ignored")
        assert.equal(
          yield* repo.fs.readFileString(repo.path.join(repo.root, ".env")),
          "PRIVATE=keep\n",
        );
      if (mode === "staged")
        assert.equal(
          (yield* repo.run(repo.root, ["show", ":file.txt"])).stdout,
          "received uncommitted work\n",
        );
    }).pipe(Effect.scoped),
  );
});
