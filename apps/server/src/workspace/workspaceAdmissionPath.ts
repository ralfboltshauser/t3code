import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const workspaceAdmissionPath = Effect.fn("Workspace.admissionPath")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let candidate = path.resolve(cwd);
  const missing: string[] = [];
  while (true) {
    const resolved = yield* fs.realPath(candidate).pipe(Effect.result);
    if (resolved._tag === "Success") return path.join(resolved.success, ...missing.toReversed());
    const info = yield* fs.lstat(candidate).pipe(Effect.result);
    // A dangling link cannot safely reserve a future checkout at its lexical path.
    if (info._tag === "Success" || info.failure.reason._tag !== "NotFound")
      return yield* resolved.failure;
    const parent = path.dirname(candidate);
    if (parent === candidate) return yield* resolved.failure;
    missing.push(path.basename(candidate));
    candidate = parent;
  }
});
