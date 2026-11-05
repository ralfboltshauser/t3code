import { create } from "zustand";
import type {
  SidebarProfileMutation,
  SidebarProfilesDocument,
  ScopedProjectRef,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import {
  ALL_PROFILES_ID,
  GENERAL_PROFILE_ID,
  defaultSidebarProfiles,
  projectsInSidebarProfile,
  sidebarProfileForProject,
} from "@t3tools/client-runtime/sidebar-profiles";
import { toastManager } from "./components/ui/toast";
import { transactSidebarProfiles } from "./sidebarProfilesStorage";
import { useProjects } from "./state/entities";
import { getClientSettings, useBoringSidebarEnabled } from "./hooks/useSettings";

interface ProfileState {
  document: SidebarProfilesDocument;
  ready: boolean;
  error: string | null;
  activeId: string;
  managerOpen: boolean;
  moveProjects: readonly ScopedProjectRef[];
}
function initialSelection() {
  try {
    return (
      sessionStorage.getItem("t3:sidebar-profile") ??
      localStorage.getItem("t3:last-sidebar-profile") ??
      GENERAL_PROFILE_ID
    );
  } catch {
    return GENERAL_PROFILE_ID;
  }
}
export const useSidebarProfiles = create<ProfileState>(() => ({
  document: defaultSidebarProfiles(),
  ready: false,
  error: null,
  activeId: initialSelection(),
  managerOpen: false,
  moveProjects: [],
}));
let hydration: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;
function accept(document: SidebarProfilesDocument) {
  const state = useSidebarProfiles.getState();
  if (state.ready && document.revision < state.document.revision) return;
  const activeId =
    state.activeId === ALL_PROFILES_ID || document.profiles.some((p) => p.id === state.activeId)
      ? state.activeId
      : GENERAL_PROFILE_ID;
  useSidebarProfiles.setState({ document, activeId, ready: true, error: null });
}
export function loadSidebarProfiles(): Promise<void> {
  return (hydration ??= (async () => {
    if (window.desktopBridge?.onSidebarProfilesChanged) {
      window.desktopBridge.onSidebarProfilesChanged(accept);
    } else if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("t3:sidebar-profiles");
      channel.onmessage = () => {
        void transactSidebarProfiles().then(accept).catch(reportError);
      };
    }
    try {
      accept(await transactSidebarProfiles());
    } catch (error) {
      reportError(error);
    }
  })());
}
function reportError(error: unknown) {
  useSidebarProfiles.setState({
    ready: true,
    error: error instanceof Error ? error.message : "Cannot save sidebar profiles.",
  });
}
export async function mutateSidebarProfiles(mutation: SidebarProfileMutation) {
  await loadSidebarProfiles();
  try {
    const document = await transactSidebarProfiles(mutation);
    accept(document);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin parameter
    channel?.postMessage(document.revision);
    return document;
  } catch (error) {
    reportError(error);
    throw error;
  }
}
export function selectSidebarProfile(activeId: string) {
  useSidebarProfiles.setState({ activeId });
  try {
    sessionStorage.setItem("t3:sidebar-profile", activeId);
    localStorage.setItem("t3:last-sidebar-profile", activeId);
  } catch {
    /* Selection still works when storage is unavailable. */
  }
}
export function openProfileManager(projects: readonly ScopedProjectRef[] = []) {
  useSidebarProfiles.setState({ managerOpen: true, moveProjects: projects });
}
export function sidebarProfilesActive() {
  const { document } = useSidebarProfiles.getState();
  const settings = getClientSettings();
  return document.enabled && (settings.boringSidebarEnabled || settings.legacySidebarEnabled);
}
export function currentCreationProfile() {
  const state = useSidebarProfiles.getState();
  return sidebarProfilesActive() && state.activeId !== ALL_PROFILES_ID
    ? state.activeId
    : GENERAL_PROFILE_ID;
}
export function filterProfileProjects<T extends { environmentId: EnvironmentId; id: ProjectId }>(
  projects: readonly T[],
) {
  const state = useSidebarProfiles.getState();
  return sidebarProfilesActive()
    ? projectsInSidebarProfile(projects, state.document, state.activeId)
    : projects;
}
export function useProfileProjects() {
  const projects = useProjects();
  const document = useSidebarProfiles((s) => s.document);
  const activeId = useSidebarProfiles((s) => s.activeId);
  const boring = useBoringSidebarEnabled();
  return boring ? projectsInSidebarProfile(projects, document, activeId) : projects;
}
export function useProfilesActive() {
  const enabled = useSidebarProfiles((s) => s.document.enabled);
  const boring = useBoringSidebarEnabled();
  return enabled && boring;
}
export async function assignCreatedProject(project: ScopedProjectRef, profileId: string) {
  try {
    await mutateSidebarProfiles({ kind: "assign-projects", projects: [project], profileId });
  } catch {
    toastManager.add({
      type: "error",
      title: "Project created; profile assignment needs retry",
      description:
        "The project is safe. Assign it in Manage profiles; do not create or clone it again.",
    });
    openProfileManager([project]);
  }
}
export function projectProfile(project: ScopedProjectRef) {
  return sidebarProfileForProject(useSidebarProfiles.getState().document, project);
}
