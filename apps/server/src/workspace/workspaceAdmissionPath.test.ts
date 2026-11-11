import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { workspaceAdmissionPath } from "./workspaceAdmissionPath.ts";

it.effect(
  "resolves missing checkout paths through existing aliases without following dangling links",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "workspace-admission-" }),
      );
      const actual = path.join(root, "actual");
      const alias = path.join(root, "alias");
      yield* fs.makeDirectory(actual);
      yield* fs.symlink(actual, alias);
      assert.equal(
        yield* workspaceAdmissionPath(path.join(alias, "removed", "nested")),
        path.join(actual, "removed", "nested"),
      );
      const dangling = path.join(root, "dangling");
      yield* fs.symlink(path.join(actual, "retired"), dangling);
      assert.equal((yield* workspaceAdmissionPath(dangling).pipe(Effect.result))._tag, "Failure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
