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
import * as Queue from "effect/Queue";
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
        Effect.succeed(false),
      ).pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(childReady);

      assert.include(
        watch.mock.calls.map(([directory]) => directory),
        outside,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.live.skipIf(!symlinksSupported)(
  "backs off stopped watches for an unchanged linked directory",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped();
      const entry = path.join(base, "linked");
      const first = path.join(base, "first", "themes");
      const second = path.join(base, "second", "themes");
      yield* fs.makeDirectory(first, { recursive: true });
      yield* fs.makeDirectory(second, { recursive: true });
      yield* fs.symlink(first, entry);
      const firstIdentity = yield* fs.stat(first);
      const secondIdentity = yield* fs.stat(second);
      let identity = firstIdentity;
      const events = yield* Queue.unbounded<"probe" | "refresh">();

      // An ended child emits a final refresh, as it does when registration fails.
      yield* watchDirectoryPath(entry, Stream.succeed(undefined), Effect.succeed(false)).pipe(
        Stream.runForEach(() => Queue.offer(events, "refresh")),
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.FileSystem.of({
            ...fs,
            stat: (file) =>
              file === entry
                ? Queue.offer(events, "probe").pipe(Effect.map(() => identity))
                : fs.stat(file),
          }),
        ),
        Effect.forkScoped,
      );
      assert.deepEqual(
        yield* Queue.takeN(events, 10),
        // Each acquire stats too: the first, a retry after 1 tick, then after 2 more.
        [
          "probe",
          "probe",
          "refresh",
          "probe",
          "probe",
          "refresh",
          "probe",
          "probe",
          "probe",
          "refresh",
        ],
      );

      identity = secondIdentity;
      assert.deepEqual(yield* Queue.takeN(events, 3), ["probe", "probe", "refresh"]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.live.skipIf(!symlinksSupported)(
  "rebuilds when a probe sees a tree other than the one the watches were acquired on",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped();
      const entry = path.join(base, "linked");
      const first = path.join(base, "first");
      const second = path.join(base, "second");
      yield* fs.makeDirectory(first);
      yield* fs.makeDirectory(second);
      yield* fs.symlink(first, entry);
      const a = yield* fs.stat(first);
      const b = yield* fs.stat(second);
      // Probe A, acquire A, probe B, swap back and acquire A, then B returns for the next probe.
      const identities = [a, a, b, a, b, b];
      const refreshes = yield* Queue.unbounded<void>();

      yield* watchDirectoryPath(
        entry,
        Stream.concat(Stream.succeed(undefined), Stream.never),
        Effect.succeed(false),
      ).pipe(
        Stream.runForEach(() => Queue.offer(refreshes, undefined)),
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.FileSystem.of({
            ...fs,
            stat: (file) =>
              file === entry ? Effect.sync(() => identities.shift() ?? b) : fs.stat(file),
          }),
        ),
        Effect.forkScoped,
      );
      yield* Queue.takeN(refreshes, 3);
      assert.deepEqual(identities, []);
    }).pipe(Effect.provide(NodeServices.layer)),
);
