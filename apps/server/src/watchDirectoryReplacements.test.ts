// @effect-diagnostics nodeBuiltinImport:off - assert which paths the native parent watches register.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { watchDirectoryPath } from "./watchDirectoryReplacements.ts";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(actual.watch) };
});

it.effect.skipIf(!symlinksSupported || HostProcess.Platform.defaultValue() === "win32")(
  "keeps watching a missing target's parent through a symlink followed by ..",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-watch-target-" });
      const userdata = path.join(base, "userdata");
      const outside = path.join(base, "outside");
      const targetParent = path.join(outside, "active-parent");
      yield* fs.makeDirectory(path.join(userdata, "active"), { recursive: true });
      yield* fs.makeDirectory(outside);
      yield* fs.symlink(path.join(targetParent, "anchor"), path.join(userdata, "alias"));
      const entry = path.join(userdata, "themes");
      yield* fs.symlink("alias/../active", entry);

      const watch = vi.mocked(NodeFS.watch);
      watch.mockClear();
      const childReady = yield* Deferred.make<void>();
      yield* watchDirectoryPath(
        entry,
        Stream.fromEffect(Deferred.succeed(childReady, undefined)).pipe(
          Stream.as(undefined),
          Stream.concat(Stream.never),
        ),
      ).pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(childReady);

      assert.include(
        watch.mock.calls.map(([directory]) => directory),
        outside,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
