import { SidebarProfilesDocument, SidebarProfileMutation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DesktopSidebarProfiles } from "../../settings/DesktopSidebarProfiles.ts";
import { ElectronWindow } from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

export const getSidebarProfiles = DesktopIpc.makeIpcMethod({
  channel: Channels.GET_SIDEBAR_PROFILES_CHANNEL,
  payload: Schema.Void,
  result: SidebarProfilesDocument,
  handler: Effect.fn("desktop.ipc.sidebarProfiles.get")(function* () {
    return yield* (yield* DesktopSidebarProfiles).read;
  }),
});

export const mutateSidebarProfiles = DesktopIpc.makeIpcMethod({
  channel: Channels.MUTATE_SIDEBAR_PROFILES_CHANNEL,
  payload: SidebarProfileMutation,
  result: SidebarProfilesDocument,
  handler: Effect.fn("desktop.ipc.sidebarProfiles.mutate")(function* (mutation) {
    const document = yield* (yield* DesktopSidebarProfiles).mutate(mutation);
    yield* (yield* ElectronWindow).sendAll(Channels.SIDEBAR_PROFILES_CHANGED_CHANNEL, document);
    return document;
  }),
});
