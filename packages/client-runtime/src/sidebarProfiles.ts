import {
  SidebarProfilesDocument,
  type SidebarProfileMutation,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { scopedProjectKey } from "./environment/scoped.ts";

export const GENERAL_PROFILE_ID = "general";
export const ALL_PROFILES_ID = "all-profiles";

export function defaultSidebarProfiles(): SidebarProfilesDocument {
  return {
    version: 1,
    revision: 0,
    enabled: false,
    profiles: [{ id: GENERAL_PROFILE_ID, name: "General", icon: "◉", color: "slate" }],
    environmentDefaults: [],
    projectAssignments: [],
  };
}

const decodeDocument = Schema.decodeUnknownSync(SidebarProfilesDocument);

export function validateSidebarProfiles(value: unknown): SidebarProfilesDocument {
  const document = decodeDocument(value);
  const ids = new Set(document.profiles.map((profile) => profile.id));
  if (
    document.revision < 0 ||
    ids.size !== document.profiles.length ||
    !ids.has(GENERAL_PROFILE_ID)
  ) {
    throw new Error("The profile document has invalid or duplicate profile IDs.");
  }
  const names = new Set<string>();
  for (const profile of document.profiles) {
    const name = profile.name.trim();
    const normalized = name.normalize("NFC").toLowerCase();
    if (
      !profile.id ||
      profile.id === ALL_PROFILES_ID ||
      !name ||
      name.length > 64 ||
      names.has(normalized)
    ) {
      throw new Error("Give each profile a distinct name of 1–64 characters.");
    }
    if (profile.icon.length === 0 || profile.icon.length > 16)
      throw new Error("Choose a short profile icon or emoji.");
    names.add(normalized);
  }
  const projectKeys = document.projectAssignments.map(scopedProjectKey);
  if (
    new Set(projectKeys).size !== projectKeys.length ||
    new Set(document.environmentDefaults.map((entry) => entry.environmentId)).size !==
      document.environmentDefaults.length ||
    [...document.environmentDefaults, ...document.projectAssignments].some(
      (entry) => !ids.has(entry.profileId),
    )
  ) {
    throw new Error("A profile assignment is duplicated or references a missing profile.");
  }
  return document;
}

export function sidebarProfileForProject(
  document: SidebarProfilesDocument,
  project: ScopedProjectRef,
): string {
  return (
    document.projectAssignments.find(
      (entry) =>
        entry.environmentId === project.environmentId && entry.projectId === project.projectId,
    )?.profileId ?? sidebarProfileForEnvironment(document, project.environmentId)
  );
}

export function sidebarProfileForEnvironment(
  document: SidebarProfilesDocument,
  environmentId: string,
): string {
  return (
    document.environmentDefaults.find((entry) => entry.environmentId === environmentId)
      ?.profileId ?? GENERAL_PROFILE_ID
  );
}

export function projectsInSidebarProfile<
  T extends { environmentId: ScopedProjectRef["environmentId"]; id: ScopedProjectRef["projectId"] },
>(projects: readonly T[], document: SidebarProfilesDocument, profileId: string): readonly T[] {
  if (!document.enabled || profileId === ALL_PROFILES_ID) return projects;
  return projects.filter(
    (project) =>
      sidebarProfileForProject(document, {
        environmentId: project.environmentId,
        projectId: project.id,
      }) === profileId,
  );
}

export function applySidebarProfileMutation(
  current: SidebarProfilesDocument,
  mutation: SidebarProfileMutation,
): SidebarProfilesDocument {
  const exists = (id: string) => current.profiles.some((profile) => profile.id === id);
  const requireProfile = (id: string) => {
    if (!exists(id)) throw new Error("That profile no longer exists.");
  };
  let next = { ...current, revision: current.revision + 1 };
  switch (mutation.kind) {
    case "undo-move": {
      const restorable = mutation.assignments.filter(
        (project) => sidebarProfileForProject(current, project) === mutation.fromProfileId,
      );
      for (const assignment of restorable)
        if (assignment.profileId !== null) requireProfile(assignment.profileId);
      const keys = new Set(restorable.map(scopedProjectKey));
      next.projectAssignments = [
        ...current.projectAssignments.filter((project) => !keys.has(scopedProjectKey(project))),
        ...restorable.flatMap((project) =>
          project.profileId === null ? [] : [{ ...project, profileId: project.profileId }],
        ),
      ];
      break;
    }
    case "enable":
      next.enabled = mutation.enabled;
      break;
    case "create":
      if (exists(mutation.profile.id)) throw new Error("That profile already exists.");
      next.profiles = [
        ...current.profiles,
        { ...mutation.profile, name: mutation.profile.name.trim() },
      ];
      break;
    case "edit":
      requireProfile(mutation.profile.id);
      next.profiles = current.profiles.map((profile) =>
        profile.id === mutation.profile.id
          ? { ...mutation.profile, name: mutation.profile.name.trim() }
          : profile,
      );
      break;
    case "reorder":
      if (
        mutation.profileIds.length !== current.profiles.length ||
        new Set(mutation.profileIds).size !== current.profiles.length ||
        mutation.profileIds.some((id) => !exists(id))
      ) {
        throw new Error("Profiles changed. Try reordering them again.");
      }
      next.profiles = mutation.profileIds.map((id) =>
        current.profiles.find((profile) => profile.id === id)!,
      );
      break;
    case "assign-projects": {
      if (mutation.profileId !== null) requireProfile(mutation.profileId);
      const keys = new Set(mutation.projects.map(scopedProjectKey));
      next.projectAssignments = [
        ...current.projectAssignments.filter((project) => !keys.has(scopedProjectKey(project))),
        ...(mutation.profileId === null
          ? []
          : [
              ...new Map(
                mutation.projects.map((project) => [scopedProjectKey(project), project]),
              ).values(),
            ].map((project) => ({ ...project, profileId: mutation.profileId! }))),
      ];
      break;
    }
    case "assign-environment":
      if (mutation.profileId !== null) requireProfile(mutation.profileId);
      next.environmentDefaults = [
        ...current.environmentDefaults.filter(
          (entry) => entry.environmentId !== mutation.environmentId,
        ),
        ...(mutation.profileId === null
          ? []
          : [{ environmentId: mutation.environmentId, profileId: mutation.profileId }]),
      ];
      break;
    case "delete":
      requireProfile(mutation.profileId);
      requireProfile(mutation.destinationId);
      if (
        mutation.profileId === GENERAL_PROFILE_ID ||
        mutation.profileId === mutation.destinationId
      )
        throw new Error("Choose another destination. General cannot be deleted.");
      next = {
        ...next,
        profiles: current.profiles.filter((profile) => profile.id !== mutation.profileId),
        environmentDefaults: current.environmentDefaults.map((entry) =>
          entry.profileId === mutation.profileId
            ? { ...entry, profileId: mutation.destinationId }
            : entry,
        ),
        projectAssignments: current.projectAssignments.map((entry) =>
          entry.profileId === mutation.profileId
            ? { ...entry, profileId: mutation.destinationId }
            : entry,
        ),
      };
  }
  return validateSidebarProfiles(next);
}
