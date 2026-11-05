import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId } from "./baseSchemas.ts";

export const SIDEBAR_PROFILE_COLORS = [
  "slate",
  "blue",
  "violet",
  "green",
  "amber",
  "rose",
] as const;
export const SidebarProfileColor = Schema.Literals(SIDEBAR_PROFILE_COLORS);
export type SidebarProfileColor = typeof SidebarProfileColor.Type;

export const SidebarProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.String,
  color: SidebarProfileColor,
});
export type SidebarProfile = typeof SidebarProfile.Type;

export const SidebarProfileProject = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export const SidebarProfilesDocument = Schema.Struct({
  version: Schema.Literal(1),
  revision: Schema.Int,
  enabled: Schema.Boolean,
  profiles: Schema.Array(SidebarProfile),
  environmentDefaults: Schema.Array(
    Schema.Struct({ environmentId: EnvironmentId, profileId: Schema.String }),
  ),
  projectAssignments: Schema.Array(
    Schema.Struct({ ...SidebarProfileProject.fields, profileId: Schema.String }),
  ),
});
export type SidebarProfilesDocument = typeof SidebarProfilesDocument.Type;

export const SidebarProfileMutation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("undo-move"),
    fromProfileId: Schema.String,
    assignments: Schema.Array(
      Schema.Struct({ ...SidebarProfileProject.fields, profileId: Schema.NullOr(Schema.String) }),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("enable"), enabled: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("create"), profile: SidebarProfile }),
  Schema.Struct({ kind: Schema.Literal("edit"), profile: SidebarProfile }),
  Schema.Struct({ kind: Schema.Literal("reorder"), profileIds: Schema.Array(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal("assign-projects"),
    projects: Schema.Array(SidebarProfileProject),
    profileId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("assign-environment"),
    environmentId: EnvironmentId,
    profileId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("delete"),
    profileId: Schema.String,
    destinationId: Schema.String,
  }),
]);
export type SidebarProfileMutation = typeof SidebarProfileMutation.Type;
