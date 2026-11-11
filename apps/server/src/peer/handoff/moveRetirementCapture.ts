import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import type { GitCommandError } from "@t3tools/contracts";
import type { PlatformError } from "effect/PlatformError";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { moveWorkspaceMetadataReason } from "./moveWorkspaceMetadata.ts";

export const moveRetirementCaptureReason = Effect.fn("MoveRetirement.captureReason")(function* (
  root: string,
  tip: string,
  snapshot: string,
  provenance: string | null = null,
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  if (platform !== "darwin" && platform !== "linux")
    return "Automatic retirement is not supported on this filesystem platform.";
  if (((yield* fs.lstat(root)).mode & 0o7777) !== 0o755)
    return "Workspace permissions require preserving this source.";
  const run = (args: ReadonlyArray<string>, stdin?: string) =>
    git.execute({
      operation: "MoveRetirement.inspect",
      cwd: root,
      args,
      maxOutputBytes: 4 * 1024 * 1024,
      ...(stdin === undefined ? {} : { stdin }),
    });
  const text = Effect.fn("MoveRetirement.gitText")(function* (args: ReadonlyArray<string>) {
    const result = yield* run(args);
    if (result.stdoutTruncated) return null;
    return result.stdout;
  });
  if ((yield* text(["rev-parse", "HEAD"]))?.trim() !== tip)
    return "The source commit changed after capture.";
  const index = yield* text(["ls-files", "-v", "-z"]);
  if (index === null || index.split("\0").some((entry) => entry !== "" && !entry.startsWith("H ")))
    return "The index has unsupported flags or entries. Commit or resolve them before removing the source.";
  if ((yield* text(["diff", "--ita-visible-in-index", "--cached", "--raw", tip, "--"])) !== "")
    return "Staged work remains on this machine. Commit or export it before removing the source.";
  if ((yield* text(["ls-files", "--resolve-undo"])) !== "")
    return "The index retains conflict recovery data.";
  if ((yield* text(["rev-parse", "--shared-index-path"]))?.trim() !== "")
    return "A split index requires preserving this source.";
  const config = yield* run([
    "config",
    "--get-regexp",
    "^(core\\.(sparseCheckout|splitIndex)|extensions\\.worktreeConfig)$",
  ]).pipe(Effect.option);
  if (Option.isSome(config) && /\btrue\b/i.test(config.value.stdout))
    return "Sparse or split-index workspaces are kept for safety.";
  const tree = yield* text(["ls-tree", "-r", "-z", snapshot]);
  if (tree === null) return "The captured file list exceeds the inspection limit.";
  const expected = new Map<string, { mode: string; oid: string }>();
  const metadataPaths = [root];
  const regular: Array<{ file: string; oid: string }> = [];
  for (const entry of tree.split("\0").filter(Boolean)) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) return "The capture contains unsupported repository entries.";
    expected.set(match[3]!, { mode: match[1]!, oid: match[2]! });
  }
  let count = 0;
  const visit = Effect.fn("MoveRetirement.inspectFiles")(function* (
    relative: string,
  ): Effect.fn.Return<string | null, GitCommandError | PlatformError> {
    const directory = path.join(root, relative);
    const children = yield* fs.readDirectory(directory);
    if (relative !== "" && children.length === 0)
      return "An uncaptured empty directory remains on the source.";
    for (const name of children) {
      if (relative === "" && name === ".git") continue;
      if (++count > 10_000) return "The source exceeds the safe file inspection limit.";
      const file = relative === "" ? name : `${relative}/${name}`;
      const absolute = path.join(root, file);
      const info = yield* fs.lstat(absolute);
      metadataPaths.push(absolute);
      if (/[\x00-\x1f\x7f]/.test(file)) return "A filename requires manual preservation.";
      if (info.type === "Directory") {
        if ((info.mode & 0o7777) !== 0o755)
          return "Directory permissions are not preserved by Git.";
        const reason = yield* visit(file);
        if (reason) return reason;
        continue;
      }
      const captured = expected.get(file);
      if (!captured)
        return "Local-only or ignored files remain on this machine. Preserve or remove them before cleanup.";
      if (info.type !== "File" && info.type !== "SymbolicLink")
        return "The source contains an unsupported filesystem entry.";
      if (info.type === "File" && Option.getOrElse(info.nlink, () => 2n) !== 1n)
        return "Hard-linked files remain on the source.";
      const mode =
        info.type === "SymbolicLink" ? "120000" : info.mode & 0o111 ? "100755" : "100644";
      if (mode !== captured.mode) return "Source file modes differ from the captured version.";
      if (info.type === "File" && (info.mode & 0o7777) !== (mode === "100755" ? 0o755 : 0o644))
        return "File permissions are not preserved by Git.";
      if (info.type === "SymbolicLink") {
        if (
          (yield* run(["hash-object", "--stdin"], yield* fs.readLink(absolute))).stdout.trim() !==
          captured.oid
        )
          return "Source symlinks changed after capture.";
      } else regular.push({ file, oid: captured.oid });
      expected.delete(file);
    }
    return null;
  });
  const reason = yield* visit("");
  if (reason) return reason;
  if (expected.size !== 0) return "Captured files are missing from the source.";
  for (let start = 0; start < regular.length; start += 64) {
    const batch = regular.slice(start, start + 64);
    const hashed = yield* run(
      ["hash-object", "--no-filters", "--stdin-paths"],
      batch.map(({ file }) => JSON.stringify(file)).join("\n") + "\n",
    );
    if (hashed.stdoutTruncated || hashed.stdout.trim() !== batch.map(({ oid }) => oid).join("\n"))
      return "Source bytes changed or Git filters transformed them. The original files were kept.";
  }
  return yield* moveWorkspaceMetadataReason(root, metadataPaths, provenance);
});
