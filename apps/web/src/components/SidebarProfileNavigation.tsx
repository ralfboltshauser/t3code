import type { ScopedProjectRef } from "@t3tools/contracts";
import { useUiStateStore } from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useEffect } from "react";
import { useRouter, useLocation } from "@tanstack/react-router";
import {
  ALL_PROFILES_ID,
  sidebarProfileForProject,
} from "@t3tools/client-runtime/sidebar-profiles";
import {
  useSidebarProfiles,
  loadSidebarProfiles,
  selectSidebarProfile,
  useProfilesActive,
} from "../sidebarProfiles";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useQuietThreadShell, readThreadShell } from "../state/entities";
import { useComposerDraftStore } from "../composerDraftStore";
import { useRightPanelStore } from "../rightPanelStore";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { isAppModalPage } from "./sidebar/mainAppLocation";
import { isCommandPaletteOpen } from "../commandPaletteBus";

const remembered = new Map<
  string,
  { href: string; projectScope: readonly string[]; project: ScopedProjectRef | null }
>();
export function useSwitchSidebarProfile() {
  const router = useRouter();
  const target = useThreadRouteTarget();
  return async (profileId: string) => {
    const previous = useSidebarProfiles.getState().activeId;
    if (previous === profileId) return;
    const current =
      target?.kind === "server"
        ? readThreadShell(target.threadRef)
        : target?.kind === "draft"
          ? useComposerDraftStore.getState().getDraftSession(target.draftId)
          : null;
    remembered.set(previous, {
      project: current
        ? { environmentId: current.environmentId, projectId: current.projectId }
        : null,
      href: router.state.location.href,
      projectScope: useUiStateStore.getState().sidebarProjectScopeKeys,
    });
    useUiStateStore
      .getState()
      .setSidebarProjectScopeKeys([...(remembered.get(profileId)?.projectScope ?? [])]);
    useThreadSelectionStore.getState().clearSelection();
    if (target?.kind === "server") useRightPanelStore.getState().close(target.threadRef);
    selectSidebarProfile(profileId);
    const destination = remembered.get(profileId);
    const belongs =
      !destination?.project ||
      profileId === ALL_PROFILES_ID ||
      sidebarProfileForProject(useSidebarProfiles.getState().document, destination.project) ===
        profileId;
    await router.navigate({ href: belongs ? (destination?.href ?? "/") : "/" });
  };
}
export function SidebarProfileNavigation() {
  const active = useProfilesActive();
  const switchProfile = useSwitchSidebarProfile();
  const document = useSidebarProfiles((s) => s.document);
  const target = useThreadRouteTarget();
  const thread = useQuietThreadShell(target?.kind === "server" ? target.threadRef : null);
  const draft = useComposerDraftStore((s) =>
    target?.kind === "draft" ? s.getDraftSession(target.draftId) : null,
  );
  const pathname = useLocation({ select: (location) => location.pathname });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers configurable shortcuts with the app keyboard dispatcher
  useEffect(() => {
    if (!active) return;
    const canSwitch = (target: EventTarget | null) =>
      !isAppModalPage(pathname) &&
      !isCommandPaletteOpen() &&
      !(target instanceof Element && target.closest('[role="dialog"], [data-keybinding-capture]'));
    const move = (direction: 1 | -1) => (event?: KeyboardEvent) => {
      const { document, activeId } = useSidebarProfiles.getState();
      const profiles = [...document.profiles.map((profile) => profile.id), ALL_PROFILES_ID];
      const index = profiles.indexOf(activeId);
      const destination =
        index === -1
          ? direction === 1
            ? profiles[0]
            : profiles.at(-1)
          : profiles[(index + direction + profiles.length) % profiles.length];
      if (!destination) return false;
      event?.preventDefault();
      event?.stopPropagation();
      void switchProfile(destination);
    };
    const unregister = registerCommands(
      { "profile.next": move(1), "profile.previous": move(-1) },
      {
        when: (event) => canSwitch(event.target),
      },
    );
    const disposers = [
      unregister,
      ...(["profile.next", "profile.previous"] as const).map((command) =>
        registerMenuAction(command, () => {
          if (canSwitch(window.document.activeElement)) move(command === "profile.next" ? 1 : -1)();
        }),
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [active, pathname, switchProfile]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- URL navigation and persisted membership changes reveal the owning profile
  useEffect(() => {
    if (pathname === "/" || pathname.startsWith("/settings")) return;
    const project = thread ?? draft;
    if (!active || !project || useSidebarProfiles.getState().activeId === ALL_PROFILES_ID) return;
    selectSidebarProfile(
      sidebarProfileForProject(document, {
        environmentId: project.environmentId,
        projectId: project.projectId,
      }),
    );
  }, [pathname, thread, draft, document, active]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hydrates client-local storage and subscribes to durable changes
  useEffect(() => {
    void loadSidebarProfiles();
  }, []);
  return null;
}
