import { ChevronsUpDownIcon, LayersIcon, Settings2Icon } from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuItem,
} from "./ui/menu";
import { randomUUID } from "../lib/utils";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ALL_PROFILES_ID,
  GENERAL_PROFILE_ID,
  sidebarProfileForEnvironment,
} from "@t3tools/client-runtime/sidebar-profiles";
import {
  SIDEBAR_PROFILE_COLORS,
  type SidebarProfile,
  type SidebarProfileMutation,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import {
  useSidebarProfiles,
  mutateSidebarProfiles,
  openProfileManager,
  useProfilesActive,
  useProfileProjects,
} from "../sidebarProfiles";
import { useSwitchSidebarProfile } from "./SidebarProfileNavigation";
import { useProjects } from "../state/entities";
import { useEnvironmentIdentities } from "../state/environments";
import { openCommandPalette } from "../commandPaletteBus";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "./ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "./ui/select";
import { SidebarInset, SidebarMenuButton } from "./ui/sidebar";

const colors: Record<SidebarProfile["color"], string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-400",
  violet: "bg-violet-400",
  green: "bg-green-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};
export function ProfileSelect({
  value,
  onChange,
  label,
  inherit = false,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  inherit?: boolean;
}) {
  const profiles = useSidebarProfiles((s) => s.document.profiles);
  const items = [
    ...(inherit ? [{ value: "inherit", label: "Use environment default" }] : []),
    ...profiles.map((p) => ({ value: p.id, label: `${p.icon} ${p.name}` })),
  ];
  return (
    <div className="w-44 shrink-0">
      <Select
        value={value}
        onValueChange={(id) => {
          if (id !== null) onChange(id);
        }}
        items={items}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
export function SidebarProfileRail() {
  const active = useProfilesActive();
  const document = useSidebarProfiles((s) => s.document);
  const activeId = useSidebarProfiles((s) => s.activeId);
  const error = useSidebarProfiles((s) => s.error);
  const switchProfile = useSwitchSidebarProfile();
  const profile = document.profiles.find((p) => p.id === activeId);
  const name = profile?.name ?? "All profiles";
  if (!active) return null;
  return (
    <div className="px-2 pt-1 pb-1">
      <Menu>
        <MenuTrigger render={<SidebarMenuButton aria-label={`Switch profile: ${name}`} />}>
          {profile ? (
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-sm">
              {profile.icon}
            </span>
          ) : (
            <LayersIcon aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <ChevronsUpDownIcon
            aria-hidden
            className="ml-auto size-3.5 shrink-0 text-sidebar-muted-foreground"
          />
        </MenuTrigger>
        <MenuPopup side="top" align="start" className="w-(--anchor-width)">
          <MenuRadioGroup value={activeId} onValueChange={(id) => void switchProfile(id)}>
            {document.profiles.map((p) => (
              <MenuRadioItem key={p.id} value={p.id} closeOnClick>
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                    {p.icon}
                  </span>
                  <span className="truncate">{p.name}</span>
                </span>
                <MenuRadioItemIndicator />
              </MenuRadioItem>
            ))}
            <MenuSeparator />
            <MenuRadioItem value={ALL_PROFILES_ID} closeOnClick>
              <span className="flex items-center gap-2">
                <LayersIcon aria-hidden />
                All profiles
              </span>
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onClick={() => openProfileManager()}>
            <Settings2Icon aria-hidden />
            Manage profiles…
          </MenuItem>
        </MenuPopup>
      </Menu>
      {error ? (
        <p role="alert" className="px-2 pt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function SidebarProfileLanding() {
  const projects = useProfileProjects();
  const profile = useSidebarProfiles((s) => s.document.profiles.find((p) => p.id === s.activeId));
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  return (
    <SidebarInset className="h-dvh">
      <div className="m-auto flex max-w-md flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">
          {profile ? `${profile.icon} ${profile.name}` : "All profiles"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {projects.length
            ? "Choose a project to start a thread, or open an existing thread in the sidebar."
            : "Add a project or move existing projects into this profile."}
        </p>
        {projects
          .filter((p) => p.archivedAt == null)
          .slice(0, 6)
          .map((p) => (
            <Button
              key={`${p.environmentId}:${p.id}`}
              variant="outline"
              onClick={() =>
                void handleNewThread({ environmentId: p.environmentId, projectId: p.id })
              }
            >
              {p.title}
            </Button>
          ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openCommandPalette({ open: "add-project" })}>Add project</Button>
          <Button variant="outline" onClick={() => openProfileManager()}>
            Manage profiles
          </Button>
          <Button variant="ghost" onClick={() => void navigate({ to: "/settings/connections" })}>
            Connect environment
          </Button>
        </div>
      </div>
    </SidebarInset>
  );
}
export function SidebarProfileManager() {
  const open = useSidebarProfiles((s) => s.managerOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(managerOpen) => useSidebarProfiles.setState({ managerOpen, moveProjects: [] })}
    >
      <DialogPopup className="w-full max-w-3xl!">
        {open ? <ProfileManagerContent /> : null}
      </DialogPopup>
    </Dialog>
  );
}
function ProfileManagerContent() {
  const document = useSidebarProfiles((s) => s.document);
  const moveProjects = useSidebarProfiles((s) => s.moveProjects);
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const [editing, setEditing] = useState<SidebarProfile | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("◉");
  const [color, setColor] = useState<SidebarProfile["color"]>("slate");
  const [destination, setDestination] = useState(GENERAL_PROFILE_ID);
  const [selected, setSelected] = useState<readonly ScopedProjectRef[]>(moveProjects);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoFrom, setUndoFrom] = useState(GENERAL_PROFILE_ID);
  const [undo, setUndo] = useState<
    readonly { project: ScopedProjectRef; profileId: string | null }[]
  >([]);
  const run = async (mutation: SidebarProfileMutation) => {
    setBusy(true);
    setError(null);
    try {
      await mutateSidebarProfiles(mutation);
      setBusy(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save profiles.");
      setBusy(false);
      return false;
    }
  };
  const reorder = (id: string, index: number) => {
    const ids = document.profiles.map((p) => p.id).filter((p) => p !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    void run({ kind: "reorder", profileIds: ids });
  };
  return (
    <div className="flex min-h-0 flex-col gap-4 p-5">
      <div>
        <DialogTitle>Sidebar profiles</DialogTitle>
        <DialogDescription>
          Separate work contexts across your connected environments. Saved on this client; running
          work keeps going when you switch.
        </DialogDescription>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="max-h-[65dvh] space-y-6 overflow-y-auto pr-1">
        <section className="space-y-2" aria-label="Profile order">
          {document.profiles.map((p, index) => (
            <div
              key={p.id}
              draggable={!busy}
              onDragStart={(event) => event.dataTransfer.setData("application/x-t3-profile", p.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("application/x-t3-profile");
                if (document.profiles.some((p) => p.id === id)) reorder(id, index);
              }}
              className="flex items-center gap-2 rounded-md border border-border p-2"
            >
              <span className={`h-2 w-2 rounded-full ${colors[p.color]}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.icon} {p.name}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || index === 0}
                aria-label={`Move ${p.name} up`}
                onClick={() => reorder(p.id, index - 1)}
              >
                ↑
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || index === document.profiles.length - 1}
                aria-label={`Move ${p.name} down`}
                onClick={() => reorder(p.id, index + 1)}
              >
                ↓
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(p);
                  setName(p.name);
                  setIcon(p.icon);
                  setColor(p.color);
                }}
              >
                Edit
              </Button>
              {p.id !== GENERAL_PROFILE_ID ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || destination === p.id}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${p.name}? Its projects and environment defaults will move to ${document.profiles.find((p) => p.id === destination)?.name}. No projects or chats are deleted.`,
                      )
                    )
                      void run({ kind: "delete", profileId: p.id, destinationId: destination });
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ))}
        </section>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              kind: editing ? "edit" : "create",
              profile: { id: editing?.id ?? randomUUID(), name, icon, color },
            }).then((saved) => {
              if (saved) {
                setEditing(null);
                setName("");
              }
            });
          }}
        >
          <h3 className="text-sm font-medium">
            {editing ? `Edit ${editing.name}` : "New profile"}
          </h3>
          <div className="grid grid-cols-[4rem_1fr] gap-2">
            <Input
              aria-label="Profile icon"
              value={icon}
              maxLength={16}
              onChange={(event) => setIcon(event.target.value)}
            />
            <Input
              aria-label="Profile name"
              placeholder="Work, Personal…"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={color}
              onValueChange={(value) => {
                if (value) setColor(value);
              }}
            >
              <SelectTrigger aria-label="Profile color">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {SIDEBAR_PROFILE_COLORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button size="sm" disabled={busy || !name.trim()} type="submit">
              {editing ? "Save profile" : "Create profile"}
            </Button>
            {editing ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setName("");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Environment defaults</h3>
          <p className="text-xs text-muted-foreground">
            Projects without an individual assignment, including new projects, use this profile. An
            environment can contain projects from several profiles.
          </p>
          {environments.map((environment) => (
            <div
              className="flex items-center justify-between gap-3"
              key={environment.environmentId}
            >
              <span className="truncate text-sm">{environment.label}</span>
              <ProfileSelect
                label={`Default profile for ${environment.label}`}
                value={sidebarProfileForEnvironment(document, environment.environmentId)}
                onChange={(profileId) =>
                  void run({
                    kind: "assign-environment",
                    environmentId: environment.environmentId,
                    profileId,
                  })
                }
              />
            </div>
          ))}
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Projects</h3>
          <Input
            type="search"
            aria-label="Find projects to assign"
            placeholder="Find a project or environment…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ProfileSelect label="Move destination" value={destination} onChange={setDestination} />
            <Button
              size="sm"
              disabled={busy || selected.length === 0}
              onClick={() => {
                const previous = selected.map((project) => ({
                  project,
                  profileId:
                    document.projectAssignments.find(
                      (p) =>
                        p.environmentId === project.environmentId &&
                        p.projectId === project.projectId,
                    )?.profileId ?? null,
                }));
                void run({
                  kind: "assign-projects",
                  projects: selected,
                  profileId: destination,
                }).then((saved) => {
                  if (saved) {
                    setUndo(previous);
                    setUndoFrom(destination);
                    setSelected([]);
                  }
                });
              }}
            >
              Move {selected.length || "selected"}
            </Button>
            {undo.length ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    if (
                      !(await run({
                        kind: "undo-move",
                        fromProfileId: undoFrom,
                        assignments: undo.map((item) => ({
                          ...item.project,
                          profileId: item.profileId,
                        })),
                      }))
                    )
                      return;
                    setUndo([]);
                  })();
                }}
              >
                Undo move
              </Button>
            ) : null}
          </div>
          {projects
            .filter((project) =>
              `${project.title} ${environments.find((e) => e.environmentId === project.environmentId)?.label ?? project.environmentId}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((project) => {
              const ref = { environmentId: project.environmentId, projectId: project.id };
              const checked = selected.some(
                (p) => p.environmentId === ref.environmentId && p.projectId === ref.projectId,
              );
              const assignment = document.projectAssignments.find(
                (p) => p.environmentId === ref.environmentId && p.projectId === ref.projectId,
              );
              return (
                <div
                  className="flex items-center justify-between gap-3 border-b border-border py-2"
                  key={`${project.environmentId}:${project.id}`}
                >
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelected(
                          checked
                            ? selected.filter(
                                (p) =>
                                  !(
                                    p.environmentId === ref.environmentId &&
                                    p.projectId === ref.projectId
                                  ),
                              )
                            : [...selected, ref],
                        )
                      }
                    />
                    <span className="truncate">
                      {project.title}
                      <span className="block text-xs text-muted-foreground">
                        {environments.find((e) => e.environmentId === project.environmentId)
                          ?.label ?? project.environmentId}
                        {project.archivedAt ? " · archived" : ""}
                      </span>
                    </span>
                  </label>
                  <ProfileSelect
                    label={`Profile for ${project.title} on ${project.environmentId}`}
                    value={assignment?.profileId ?? "inherit"}
                    inherit
                    onChange={(profileId) =>
                      void run({
                        kind: "assign-projects",
                        projects: [ref],
                        profileId: profileId === "inherit" ? null : profileId,
                      })
                    }
                  />
                </div>
              );
            })}
        </section>
      </div>
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => useSidebarProfiles.setState({ managerOpen: false, moveProjects: [] })}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
