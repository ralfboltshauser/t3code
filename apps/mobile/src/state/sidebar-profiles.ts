import { useEffect } from "react";
import { sidebarProfileForProject } from "@t3tools/client-runtime/sidebar-profiles";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import type {
  SidebarProfileMutation,
  SidebarProfilesDocument,
  ScopedProjectRef,
} from "@t3tools/contracts";
import {
  defaultSidebarProfiles,
  applySidebarProfileMutation,
  validateSidebarProfiles,
  GENERAL_PROFILE_ID,
  projectsInSidebarProfile,
} from "@t3tools/client-runtime/sidebar-profiles";
import * as Schema from "effect/Schema";
import { mobilePreferencesAtom } from "./preferences";
import { useProjects } from "./entities";
import { appAtomRegistry } from "./atom-registry";
import * as MobilePreferences from "../persistence/mobile-preferences";
import { runtime } from "../lib/runtime";

export const activeSidebarProfileAtom = Atom.make(GENERAL_PROFILE_ID).pipe(Atom.keepAlive);
export const sidebarProfilesDocumentAtom = Atom.make<SidebarProfilesDocument | null>(null).pipe(
  Atom.keepAlive,
);
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encode = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
export function readProfileDocument(raw?: string): SidebarProfilesDocument {
  return raw === undefined ? defaultSidebarProfiles() : validateSidebarProfiles(decode(raw));
}
export function useMobileSidebarProfiles() {
  const saved = useAtomValue(mobilePreferencesAtom);
  const confirmed = useAtomValue(sidebarProfilesDocumentAtom);
  const activeId = useAtomValue(activeSidebarProfileAtom);
  const raw = AsyncResult.isSuccess(saved) ? saved.value.sidebarProfiles : undefined;
  return resolveMobileProfiles(raw, confirmed, activeId);
}
function resolveMobileProfiles(
  raw: string | undefined,
  confirmed: SidebarProfilesDocument | null,
  activeId: string,
) {
  try {
    const stored = readProfileDocument(raw);
    const document = confirmed && confirmed.revision >= stored.revision ? confirmed : stored;
    return { document, activeId, error: null };
  } catch (cause) {
    return {
      document: defaultSidebarProfiles(),
      activeId,
      error: cause instanceof Error ? cause.message : "Cannot read profiles.",
    };
  }
}

export async function mutateMobileSidebarProfiles(mutation: SidebarProfileMutation) {
  const saved = await runtime.runPromise(
    MobilePreferences.MobilePreferencesStore.pipe(
      Effect.flatMap((store) =>
        store.update((current) => ({
          sidebarProfiles: encode(
            applySidebarProfileMutation(readProfileDocument(current.sidebarProfiles), mutation),
          ),
        })),
      ),
    ),
  );
  const document = readProfileDocument(saved.sidebarProfiles);
  appAtomRegistry.set(sidebarProfilesDocumentAtom, document);
  const activeId = appAtomRegistry.get(activeSidebarProfileAtom);
  if (!document.profiles.some((p) => p.id === activeId) && activeId !== "all-profiles")
    appAtomRegistry.set(activeSidebarProfileAtom, GENERAL_PROFILE_ID);
  return document;
}
export function selectMobileSidebarProfile(id: string) {
  appAtomRegistry.set(activeSidebarProfileAtom, id);
}
export function mobileCreationProfile() {
  return appAtomRegistry.get(activeSidebarProfileAtom) === "all-profiles"
    ? GENERAL_PROFILE_ID
    : appAtomRegistry.get(activeSidebarProfileAtom);
}
export async function assignMobileCreatedProject(project: ScopedProjectRef, profileId: string) {
  const saved = appAtomRegistry.get(mobilePreferencesAtom);
  const document =
    appAtomRegistry.get(sidebarProfilesDocumentAtom) ??
    readProfileDocument(AsyncResult.isSuccess(saved) ? saved.value.sidebarProfiles : undefined);
  if (document.enabled)
    await mutateMobileSidebarProfiles({ kind: "assign-projects", projects: [project], profileId });
}
export function useMobileProfileProjects() {
  const projects = useProjects();
  const { document, activeId } = useMobileSidebarProfiles();
  return projectsInSidebarProfile(projects, document, activeId);
}

export function useMobileProfileRoute(
  project: ScopedProjectRef | null,
  navigation: { key: string; focused: boolean },
) {
  const { key, focused } = navigation;
  const { document } = useMobileSidebarProfiles();
  const environmentId = project?.environmentId;
  const projectId = project?.projectId;
  const owner =
    document.enabled && environmentId && projectId
      ? sidebarProfileForProject(document, { environmentId, projectId })
      : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- route identity or ownership changes reveal its profile without following background preference refreshes
  useEffect(() => {
    if (owner && environmentId && projectId && key && focused) selectMobileSidebarProfile(owner);
  }, [owner, environmentId, projectId, key, focused]);
}

export async function assignMobileNewEnvironment(
  environmentId: ScopedProjectRef["environmentId"],
  known: readonly string[],
  profileId: string,
) {
  if (known.includes(environmentId)) return;
  const saved = appAtomRegistry.get(mobilePreferencesAtom);
  const document =
    appAtomRegistry.get(sidebarProfilesDocumentAtom) ??
    readProfileDocument(AsyncResult.isSuccess(saved) ? saved.value.sidebarProfiles : undefined);
  if (document.enabled)
    await mutateMobileSidebarProfiles({ kind: "assign-environment", environmentId, profileId });
}
