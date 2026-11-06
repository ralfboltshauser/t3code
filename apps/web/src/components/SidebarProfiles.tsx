import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { Menu, MenuTrigger, MenuPopup, MenuSeparator, MenuItem } from "./ui/menu";
import { randomUUID } from "../lib/utils";
import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ALL_PROFILES_ID,
  GENERAL_PROFILE_ID,
  sidebarProfileForEnvironment,
  sidebarProfileForProject,
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
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "./ui/alert-dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
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
  disabled = false,
  excludeProfileId,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  inherit?: boolean;
  disabled?: boolean;
  excludeProfileId?: string;
  id?: string;
}) {
  const profiles = useSidebarProfiles((s) => s.document.profiles);
  const items = [
    ...(inherit ? [{ value: "inherit", label: "Use environment default" }] : []),
    ...profiles
      .filter((p) => p.id !== excludeProfileId)
      .map((p) => ({ value: p.id, label: `${p.icon} ${p.name}` })),
  ];
  return (
    <div className="w-44 shrink-0">
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(id) => {
          if (id !== null) onChange(id);
        }}
        items={items}
      >
        <SelectTrigger id={id} aria-label={label}>
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
          {document.profiles.map((p) => (
            <MenuItem
              key={p.id}
              aria-current={activeId === p.id ? "true" : undefined}
              onClick={() => void switchProfile(p.id)}
            >
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                {p.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {activeId === p.id ? <CheckIcon aria-hidden /> : null}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            aria-current={activeId === ALL_PROFILES_ID ? "true" : undefined}
            onClick={() => void switchProfile(ALL_PROFILES_ID)}
          >
            <LayersIcon aria-hidden />
            <span className="min-w-0 flex-1">All profiles</span>
            {activeId === ALL_PROFILES_ID ? <CheckIcon aria-hidden /> : null}
          </MenuItem>
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
      <DialogPopup className="max-h-[85dvh] sm:max-w-2xl">
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
  const formId = useId();
  const [section, setSection] = useState(moveProjects.length ? "projects" : "profiles");
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<SidebarProfile | null>(null);
  const [deleting, setDeleting] = useState<SidebarProfile | null>(null);
  const [deleteDestination, setDeleteDestination] = useState(GENERAL_PROFILE_ID);
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
  const environmentLabels = new Map(environments.map((e) => [e.environmentId, e.label]));
  const filteredProjects = projects.filter((project) =>
    `${project.title} ${environmentLabels.get(project.environmentId) ?? project.environmentId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const run = async (mutation: SidebarProfileMutation) => {
    if (busy) return false;
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
  const editProfile = (profile: SidebarProfile | null) => {
    setEditing(profile);
    setName(profile?.name ?? "");
    setIcon(profile?.icon ?? "◉");
    setColor(profile?.color ?? "slate");
    setShowEditor(true);
    setError(null);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Manage profiles</DialogTitle>
        <DialogDescription>Organize projects into separate work contexts.</DialogDescription>
        <div className="pt-2">
          <ToggleGroup
            aria-label="Profile settings"
            value={[section]}
            onValueChange={(next) => {
              if (next[0]) setSection(next[0]);
            }}
          >
            <Toggle value="profiles">Profiles</Toggle>
            <Toggle value="projects">Projects</Toggle>
            <Toggle value="environments">Environments</Toggle>
          </ToggleGroup>
        </div>
      </DialogHeader>
      <DialogPanel className="min-h-56" scrollFade={false}>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {section === "profiles" ? (
          <section aria-label="Profile order" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{document.profiles.length} profiles</p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || showEditor}
                onClick={() => editProfile(null)}
              >
                <PlusIcon />
                New profile
              </Button>
            </div>
            <div className="divide-y divide-border">
              {document.profiles.map((p, index) => {
                const count = projects.filter(
                  (project) =>
                    sidebarProfileForProject(document, {
                      environmentId: project.environmentId,
                      projectId: project.id,
                    }) === p.id,
                ).length;
                return (
                  <div
                    key={p.id}
                    draggable={!busy && !showEditor}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("application/x-t3-profile", p.id)
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("application/x-t3-profile");
                      if (!busy && document.profiles.some((profile) => profile.id === id))
                        reorder(id, index);
                    }}
                    className="flex items-center gap-3 py-3"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-lg"
                    >
                      {p.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {count} {count === 1 ? "project" : "projects"}
                      </p>
                    </div>
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Actions for ${p.name}`}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => editProfile(p)}>
                          <PencilIcon />
                          Edit profile
                        </MenuItem>
                        <MenuItem disabled={index === 0} onClick={() => reorder(p.id, index - 1)}>
                          <ArrowUpIcon />
                          Move up
                        </MenuItem>
                        <MenuItem
                          disabled={index === document.profiles.length - 1}
                          onClick={() => reorder(p.id, index + 1)}
                        >
                          <ArrowDownIcon />
                          Move down
                        </MenuItem>
                        {p.id !== GENERAL_PROFILE_ID ? (
                          <>
                            <MenuSeparator />
                            <MenuItem
                              variant="destructive"
                              onClick={() => {
                                setDeleting(p);
                                setDeleteDestination(GENERAL_PROFILE_ID);
                                setError(null);
                              }}
                            >
                              <Trash2Icon />
                              Delete profile…
                            </MenuItem>
                          </>
                        ) : null}
                      </MenuPopup>
                    </Menu>
                  </div>
                );
              })}
            </div>
            {showEditor ? (
              <form
                className="space-y-4 rounded-xl border border-border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run({
                    kind: editing ? "edit" : "create",
                    profile: { id: editing?.id ?? randomUUID(), name: name.trim(), icon, color },
                  }).then((saved) => {
                    if (saved) {
                      setShowEditor(false);
                      setEditing(null);
                      setName("");
                    }
                  });
                }}
              >
                <h3 className="text-sm font-medium">
                  {editing ? `Edit ${editing.name}` : "New profile"}
                </h3>
                <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`${formId}-icon`}>Icon</Label>
                    <Input
                      id={`${formId}-icon`}
                      value={icon}
                      maxLength={16}
                      onChange={(event) => setIcon(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${formId}-name`}>Name</Label>
                    <Input
                      id={`${formId}-name`}
                      autoFocus
                      placeholder="Work, Personal…"
                      value={name}
                      maxLength={64}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-color`}>Color</Label>
                  <Select
                    value={color}
                    items={SIDEBAR_PROFILE_COLORS.map((value) => ({
                      value,
                      label: value[0]!.toUpperCase() + value.slice(1),
                    }))}
                    onValueChange={(value) => {
                      if (value) setColor(value);
                    }}
                  >
                    <SelectTrigger id={`${formId}-color`} aria-label="Profile color">
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={`size-2 rounded-full ${colors[color]}`} />
                          {color[0]!.toUpperCase() + color.slice(1)}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {SIDEBAR_PROFILE_COLORS.map((c) => (
                        <SelectItem key={c} value={c}>
                          <span className="flex items-center gap-2">
                            <span aria-hidden className={`size-2 rounded-full ${colors[c]}`} />
                            {c[0]!.toUpperCase() + c.slice(1)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setShowEditor(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" disabled={busy || !name.trim() || !icon.trim()} type="submit">
                    {busy ? "Saving…" : editing ? "Save changes" : "Create profile"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drag profiles to reorder them, or use their action menu.
              </p>
            )}
          </section>
        ) : section === "projects" ? (
          <section aria-label="Project assignments" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose a profile for each project, or select several to move together.
            </p>
            <Input
              type="search"
              aria-label="Find projects to assign"
              placeholder="Search projects or environments…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {selected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3">
                <span className="mr-auto text-sm">{selected.length} selected</span>
                <ProfileSelect
                  label="Move destination"
                  value={destination}
                  onChange={setDestination}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  disabled={busy}
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
                  Move {selected.length}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            ) : null}
            {undo.length > 0 ? (
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>Projects moved.</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void run({
                      kind: "undo-move",
                      fromProfileId: undoFrom,
                      assignments: undo.map((item) => ({
                        ...item.project,
                        profileId: item.profileId,
                      })),
                    }).then((saved) => {
                      if (saved) setUndo([]);
                    });
                  }}
                >
                  Undo move
                </Button>
              </div>
            ) : null}
            <div className="divide-y divide-border">
              {filteredProjects.map((project) => {
                const ref = { environmentId: project.environmentId, projectId: project.id };
                const checked = selected.some(
                  (p) => p.environmentId === ref.environmentId && p.projectId === ref.projectId,
                );
                const assignment = document.projectAssignments.find(
                  (p) => p.environmentId === ref.environmentId && p.projectId === ref.projectId,
                );
                return (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                    key={`${project.environmentId}:${project.id}`}
                  >
                    <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                      <Checkbox
                        checked={checked}
                        disabled={busy}
                        onCheckedChange={(next) =>
                          setSelected((current) =>
                            next
                              ? [...current, ref]
                              : current.filter(
                                  (p) =>
                                    !(
                                      p.environmentId === ref.environmentId &&
                                      p.projectId === ref.projectId
                                    ),
                                ),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{project.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {environmentLabels.get(project.environmentId) ?? project.environmentId}
                          {project.archivedAt ? " · Archived" : ""}
                        </span>
                      </span>
                    </label>
                    <ProfileSelect
                      label={`Profile for ${project.title} on ${project.environmentId}`}
                      value={assignment?.profileId ?? "inherit"}
                      inherit
                      disabled={busy}
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
            </div>
            {filteredProjects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {query
                  ? "No matching projects."
                  : "No projects yet. Add a project from the sidebar to get started."}
              </p>
            ) : null}
          </section>
        ) : (
          <section aria-label="Environment defaults" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose where new and unassigned projects appear. Individual project assignments take
              priority.
            </p>
            <div className="divide-y divide-border">
              {environments.map((environment) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={environment.environmentId}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{environment.label}</p>
                    <p className="text-xs text-muted-foreground">Default profile</p>
                  </div>
                  <ProfileSelect
                    label={`Default profile for ${environment.label}`}
                    value={sidebarProfileForEnvironment(document, environment.environmentId)}
                    disabled={busy}
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
            </div>
            {environments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Connect an environment to choose its default profile.
              </p>
            ) : null}
          </section>
        )}
      </DialogPanel>
      <DialogFooter variant="bare">
        <p className="mr-auto self-center text-xs text-muted-foreground">Saved on this device</p>
        <Button
          variant="outline"
          onClick={() => useSidebarProfiles.setState({ managerOpen: false, moveProjects: [] })}
        >
          Done
        </Button>
      </DialogFooter>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Move its projects and environment defaults to another profile. Projects and chats are
              kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 px-6 pb-4">
            <Label htmlFor={`${formId}-delete-destination`}>Move to</Label>
            <ProfileSelect
              id={`${formId}-delete-destination`}
              label="Destination for deleted profile"
              value={deleteDestination}
              onChange={setDeleteDestination}
              excludeProfileId={deleting?.id ?? ""}
              disabled={busy}
            />
            {error ? (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting)
                  void run({
                    kind: "delete",
                    profileId: deleting.id,
                    destinationId: deleteDestination,
                  }).then((saved) => {
                    if (saved) {
                      setDeleting(null);
                      setShowEditor(false);
                      setEditing(null);
                    }
                  });
              }}
            >
              {busy ? "Deleting…" : "Delete profile"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
