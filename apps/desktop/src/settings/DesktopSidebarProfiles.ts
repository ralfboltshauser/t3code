import { type SidebarProfileMutation, type SidebarProfilesDocument } from "@t3tools/contracts";
import {
  applySidebarProfileMutation,
  defaultSidebarProfiles,
  validateSidebarProfiles,
} from "@t3tools/client-runtime/sidebar-profiles";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";

export class SidebarProfilesStorageError extends Schema.TaggedError<SidebarProfilesStorageError>()(
  "SidebarProfilesStorageError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : "Could not read or save sidebar profiles.";
  }
}

export class DesktopSidebarProfiles extends Context.Service<
  DesktopSidebarProfiles,
  {
    readonly read: Effect.Effect<SidebarProfilesDocument, SidebarProfilesStorageError>;
    readonly mutate: (
      mutation: SidebarProfileMutation,
    ) => Effect.Effect<SidebarProfilesDocument, SidebarProfilesStorageError>;
  }
>()("@t3tools/desktop/settings/DesktopSidebarProfiles") {}

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const filename = path.join(environment.stateDir, "sidebar-profiles.json");
  const storageError = (cause: unknown) => new SidebarProfilesStorageError({ cause });
  const read = Effect.fn("DesktopSidebarProfiles.read")(function* () {
    const raw = yield* fs.readFileString(filename).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
      }),
      Effect.mapError(storageError),
    );
    if (raw === null) return defaultSidebarProfiles();
    const value = yield* decodeJson(raw).pipe(Effect.mapError(storageError));
    return yield* Effect.try({ try: () => validateSidebarProfiles(value), catch: storageError });
  });
  return DesktopSidebarProfiles.of({
    read: read(),
    mutate: Effect.fn("DesktopSidebarProfiles.mutate")(function (mutation) {
      return Effect.gen(function* () {
        const current = yield* read();
        const next = yield* Effect.try({
          try: () => applySidebarProfileMutation(current, mutation),
          catch: storageError,
        });
        const temporary = `${filename}.tmp`;
        yield* fs
          .makeDirectory(environment.stateDir, { recursive: true })
          .pipe(Effect.mapError(storageError));
        const encoded = yield* encodeJson(next).pipe(Effect.mapError(storageError));
        yield* fs.writeFileString(temporary, `${encoded}\n`).pipe(Effect.mapError(storageError));
        yield* fs.rename(temporary, filename).pipe(Effect.mapError(storageError));
        return next;
      }).pipe(lock.withPermits(1));
    }),
  });
});

export const layer = Layer.effect(DesktopSidebarProfiles, make);
