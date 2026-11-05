import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopSidebarProfiles from "./DesktopSidebarProfiles.ts";

function layer(baseDir: string) {
  const layerEnvironment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodeCrypto.layer,
        DesktopConfig.layerTest({ T3CODE_HOME: baseDir }),
      ),
    ),
  );

  return DesktopSidebarProfiles.layer.pipe(
    Layer.provideMerge(layerEnvironment),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
}

const withProfiles = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopSidebarProfiles.DesktopSidebarProfiles>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-sidebar-profiles-test-",
    });
    return yield* effect.pipe(Effect.provide(layer(baseDir)));
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)), Effect.scoped);

describe("DesktopSidebarProfiles", () => {
  it.effect(
    "serializes concurrent operations and preserves the last committed document after a rejected mutation",
    () =>
      withProfiles(
        Effect.gen(function* () {
          const profiles = yield* DesktopSidebarProfiles.DesktopSidebarProfiles;
          yield* Effect.forEach(
            ["work", "personal"],
            (id) =>
              profiles.mutate({
                kind: "create",
                profile: { id, name: id, icon: "◉", color: "blue" },
              }),
            { concurrency: "unbounded" },
          );
          const saved = yield* profiles.read;
          assert.equal(saved.revision, 2);
          assert.deepEqual(saved.profiles.map((p) => p.id).toSorted(), [
            "general",
            "personal",
            "work",
          ]);
          yield* profiles
            .mutate({ kind: "delete", profileId: "general", destinationId: "work" })
            .pipe(Effect.flip);
          assert.deepEqual(yield* profiles.read, saved);
          const fs = yield* FileSystem.FileSystem;
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          yield* fs.writeFileString(
            `${environment.stateDir}/sidebar-profiles.json`,
            "invalid data",
          );
          yield* profiles.mutate({ kind: "enable", enabled: true }).pipe(Effect.flip);
          assert.equal(
            yield* fs.readFileString(`${environment.stateDir}/sidebar-profiles.json`),
            "invalid data",
          );
        }),
      ),
  );
});
