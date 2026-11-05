import { describe, expect, it } from "vite-plus/test";
import { type EnvironmentId, type ProjectId } from "@t3tools/contracts";

import {
  applySidebarProfileMutation,
  defaultSidebarProfiles,
  projectsInSidebarProfile,
  sidebarProfileForProject,
  validateSidebarProfiles,
} from "./sidebarProfiles.ts";

const host = "host" as EnvironmentId;
const otherHost = "other" as EnvironmentId;
const project = { environmentId: host, projectId: "project" as ProjectId };
const work = { id: "work", name: "Work", icon: "💼", color: "blue" as const };
const personal = { id: "personal", name: "Personal", icon: "🌿", color: "green" as const };

function setup() {
  return applySidebarProfileMutation(
    applySidebarProfileMutation(defaultSidebarProfiles(), { kind: "create", profile: work }),
    { kind: "create", profile: personal },
  );
}

describe("sidebar profiles", () => {
  it("inherits environment assignments, while explicit scoped projects retain their homes", () => {
    const inherited = applySidebarProfileMutation(setup(), {
      kind: "assign-environment",
      environmentId: host,
      profileId: work.id,
    });
    expect(sidebarProfileForProject(inherited, project)).toBe("work");
    const assigned = applySidebarProfileMutation(inherited, {
      kind: "assign-projects",
      projects: [project],
      profileId: personal.id,
    });
    expect(sidebarProfileForProject(assigned, project)).toBe("personal");
    expect(sidebarProfileForProject(assigned, { ...project, environmentId: otherHost })).toBe(
      "general",
    );
    const changed = applySidebarProfileMutation(assigned, {
      kind: "assign-environment",
      environmentId: host,
      profileId: "general",
    });
    expect(sidebarProfileForProject(changed, project)).toBe("personal");
    const reset = applySidebarProfileMutation(changed, {
      kind: "assign-projects",
      projects: [project],
      profileId: null,
    });
    expect(sidebarProfileForProject(reset, project)).toBe("general");
  });

  it("rehomes both existing overrides and future environment projects when deleting", () => {
    const assigned = applySidebarProfileMutation(
      applySidebarProfileMutation(setup(), {
        kind: "assign-environment",
        environmentId: host,
        profileId: work.id,
      }),
      {
        kind: "assign-projects",
        projects: [{ ...project, environmentId: otherHost }],
        profileId: work.id,
      },
    );
    const removed = applySidebarProfileMutation(assigned, {
      kind: "delete",
      profileId: "work",
      destinationId: "personal",
    });
    expect(sidebarProfileForProject(removed, project)).toBe("personal");
    expect(sidebarProfileForProject(removed, { ...project, environmentId: otherHost })).toBe(
      "personal",
    );
    expect(() =>
      applySidebarProfileMutation(removed, {
        kind: "delete",
        profileId: "general",
        destinationId: "personal",
      }),
    ).toThrow();
  });

  it("filters physical copies before grouping, preserves empty profiles and restores all on disable", () => {
    const enabled = applySidebarProfileMutation(setup(), { kind: "enable", enabled: true });
    const assigned = applySidebarProfileMutation(enabled, {
      kind: "assign-projects",
      projects: [project],
      profileId: "work",
    });
    const projects = [
      { environmentId: host, id: project.projectId },
      { environmentId: otherHost, id: project.projectId },
    ];
    expect(projectsInSidebarProfile(projects, assigned, "work")).toEqual([projects[0]]);
    expect(projectsInSidebarProfile(projects, assigned, "personal")).toEqual([]);
    const disabled = applySidebarProfileMutation(assigned, { kind: "enable", enabled: false });
    expect(projectsInSidebarProfile(projects, disabled, "work")).toBe(projects);
    expect(sidebarProfileForProject(disabled, project)).toBe("work");
  });

  it("undoes a move atomically while preserving later independent assignments", () => {
    const second = { ...project, projectId: "second" as ProjectId };
    let document = applySidebarProfileMutation(setup(), {
      kind: "assign-projects",
      projects: [project, second],
      profileId: "work",
    });
    document = applySidebarProfileMutation(document, {
      kind: "assign-projects",
      projects: [second],
      profileId: "personal",
    });
    const undone = applySidebarProfileMutation(document, {
      kind: "undo-move",
      fromProfileId: "work",
      assignments: [
        { ...project, profileId: null },
        { ...second, profileId: null },
      ],
    });
    expect(sidebarProfileForProject(undone, project)).toBe("general");
    expect(sidebarProfileForProject(undone, second)).toBe("personal");
    expect(undone.revision).toBe(document.revision + 1);
  });

  it("rejects invalid, stale and duplicate operations without changing the original document", () => {
    const original = setup();
    expect(() =>
      applySidebarProfileMutation(original, {
        kind: "create",
        profile: { ...work, id: "other", name: " WORK " },
      }),
    ).toThrow();
    expect(() =>
      applySidebarProfileMutation(original, {
        kind: "assign-projects",
        projects: [project],
        profileId: "missing",
      }),
    ).toThrow();
    expect(() =>
      applySidebarProfileMutation(original, { kind: "reorder", profileIds: ["work", "general"] }),
    ).toThrow();
    expect(() => validateSidebarProfiles({ ...original, version: 2 })).toThrow();
    const reordered = applySidebarProfileMutation(original, {
      kind: "reorder",
      profileIds: ["personal", "general", "work"],
    });
    expect(reordered.profiles.map((profile) => profile.id)).toEqual([
      "personal",
      "general",
      "work",
    ]);
    expect(original.profiles.map((profile) => profile.id)).toEqual(["general", "work", "personal"]);
  });
});
