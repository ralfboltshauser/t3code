import "../index.css";
import { transactSidebarProfiles } from "../sidebarProfilesStorage";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render, act } from "../../test/render";
import { useSidebarProfiles, openProfileManager, projectProfile } from "../sidebarProfiles";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useEnvironmentIdentities } from "../state/environments";
import { useProjects } from "../state/entities";
import { SidebarProvider } from "./ui/sidebar";
import { SidebarProfileManager, SidebarProfileRail } from "./SidebarProfiles";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { SidebarProfileNavigation } from "./SidebarProfileNavigation";
import * as dispatcher from "../shortcuts/dispatcher";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { mutateSidebarProfiles, selectSidebarProfile } from "../sidebarProfiles";
import { ALL_PROFILES_ID } from "@t3tools/client-runtime/sidebar-profiles";

vi.mock("../state/entities", { spy: true });
vi.mock("../state/environments", { spy: true });
vi.mock("../shortcuts/dispatcher", { spy: true });
const environmentId = EnvironmentId.make("profile-browser-test");
const projectId = ProjectId.make("profile-project");
function Groups() {
  const groups = useSidebarProjectGroups();
  return (
    <div>
      {groups.map((group) => (
        <span key={group.projectKey}>{group.displayName}</span>
      ))}
    </div>
  );
}
async function setup() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("t3code-sidebar-profiles");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  const previous = useSidebarProfiles.getState();
  const settings = getClientSettings();
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
  await transactSidebarProfiles({ kind: "enable", enabled: true });
  const document = await transactSidebarProfiles({
    kind: "create",
    profile: { id: "work", name: "Work", icon: "▣", color: "blue" },
  });
  useSidebarProfiles.setState({
    document,
    ready: true,
    activeId: "general",
    managerOpen: false,
    moveProjects: [],
    error: null,
  });
  vi.mocked(useEnvironmentIdentities).mockReturnValue([{ environmentId, label: "Test Mac" }]);
  vi.mocked(useProjects).mockReturnValue([
    {
      environmentId,
      id: projectId,
      title: "Work repository",
      workspaceRoot: "/profile-test",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      repositoryIdentity: null,
    },
  ]);
  return {
    [Symbol.dispose]() {
      useSidebarProfiles.setState(previous);
      __setClientSettingsForTests(settings);
      vi.mocked(useProjects).mockRestore();
      vi.mocked(useEnvironmentIdentities).mockRestore();
    },
  };
}
describe("sidebar profile integration", () => {
  it("cycles configured profile shortcuts in current order, including All profiles when wrapping", async () => {
    using _setup = await setup();
    const keybindings = compileResolvedKeybindingsConfig([
      { command: "profile.next", key: "ctrl+alt+arrowright" },
      { command: "profile.previous", key: "ctrl+alt+arrowleft" },
    ]);
    const {
      registerCommands: register,
      registerMenuAction,
      dispatchMenuAction,
    } = await vi.importActual<typeof dispatcher>("../shortcuts/dispatcher");
    using _commands = vi
      .spyOn(dispatcher, "registerCommands")
      .mockImplementation((commands, options) =>
        register(commands, { ...options, keybindings: () => keybindings }),
      );
    using _menuCommands = vi
      .spyOn(dispatcher, "registerMenuAction")
      .mockImplementation(registerMenuAction);
    await using screen = await render(
      <SidebarProvider>
        <input aria-label="Shortcut recorder" data-keybinding-capture />
        <SidebarProfileNavigation />
        <SidebarProfileRail />
      </SidebarProvider>,
    );
    const press = (key: "ArrowLeft" | "ArrowRight", target: EventTarget = window) => {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        altKey: true,
        cancelable: true,
        bubbles: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    expect(press("ArrowRight").defaultPrevented).toBe(true);
    await expect
      .element(screen.getByRole("button", { name: "Switch profile: Work", exact: true }))
      .toBeVisible();
    press("ArrowRight");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe(ALL_PROFILES_ID));
    press("ArrowRight");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("general"));
    press("ArrowLeft");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe(ALL_PROFILES_ID));
    press("ArrowLeft");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("work"));
    await mutateSidebarProfiles({
      kind: "create",
      profile: { id: "personal", name: "Personal", icon: "●", color: "green" },
    });
    await mutateSidebarProfiles({ kind: "reorder", profileIds: ["personal", "work", "general"] });
    press("ArrowLeft");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("personal"));
    selectSidebarProfile(ALL_PROFILES_ID);
    press("ArrowRight");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("personal"));
    selectSidebarProfile(ALL_PROFILES_ID);
    press("ArrowLeft");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("general"));
    expect(
      press("ArrowRight", screen.getByRole("textbox", { name: "Shortcut recorder" }).element())
        .defaultPrevented,
    ).toBe(false);
    expect(useSidebarProfiles.getState().activeId).toBe("general");
    dispatchMenuAction("profile.next");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe(ALL_PROFILES_ID));
    dispatchMenuAction("profile.next");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("personal"));
    dispatchMenuAction("profile.previous");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe(ALL_PROFILES_ID));
    dispatchMenuAction("profile.previous");
    await vi.waitFor(() => expect(useSidebarProfiles.getState().activeId).toBe("general"));
    await mutateSidebarProfiles({ kind: "enable", enabled: false });
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Switch profile: General", exact: true }).query(),
      ).toBeNull(),
    );
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(useSidebarProfiles.getState().activeId).toBe("general");
  });
  it("moves a physical project out of its former sidebar and exposes it in its destination", async () => {
    using _setup = await setup();
    await using screen = await render(
      <SidebarProvider>
        <Groups />
        <SidebarProfileRail />
        <SidebarProfileManager />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("Work repository")).toBeVisible();
    await act(() => openProfileManager([{ environmentId, projectId }]));
    await page.getByRole("combobox", { name: "Move destination", exact: true }).click();
    await page.getByRole("option", { name: "▣ Work", exact: true }).click();
    await page.getByRole("button", { name: "Move 1", exact: true }).click();
    await vi.waitFor(() => expect(projectProfile({ environmentId, projectId })).toBe("work"));
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect.element(screen.getByText("Work repository")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Switch profile: General", exact: true }).click();
    await page.getByRole("menuitem", { name: "Work", exact: true }).click();
    await expect.element(screen.getByText("Work repository")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Switch profile: Work", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Switch profile: Work", exact: true }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Work", exact: true }))
      .toHaveAttribute("aria-current", "true");
    await page.getByRole("menuitem", { name: "All profiles", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Switch profile: All profiles", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Switch profile: All profiles", exact: true }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "All profiles", exact: true }))
      .toHaveAttribute("aria-current", "true");
  });
  it("creates, edits, reorders and deletes profiles through the manager", async () => {
    using _setup = await setup();
    await using _screen = await render(<SidebarProfileManager />);
    await act(() => openProfileManager());
    await page.getByRole("button", { name: "New profile", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Research");
    await page.getByRole("textbox", { name: "Icon", exact: true }).fill("🔬");
    await page.getByRole("button", { name: "Create profile", exact: true }).click();
    const created = () =>
      useSidebarProfiles.getState().document.profiles.find((p) => p.name === "Research");
    await vi.waitFor(() => expect(created()).toBeDefined());
    const id = created()!.id;
    await page.getByRole("button", { name: "Actions for Research", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
    await vi.waitFor(() => expect(useSidebarProfiles.getState().document.profiles[1]?.id).toBe(id));
    await page.getByRole("button", { name: "Actions for Research", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit profile", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Writing");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Actions for Writing", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Actions for Writing", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete profile…", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(useSidebarProfiles.getState().document.profiles.some((p) => p.id === id)).toBe(true);
    await page.getByRole("button", { name: "Actions for Writing", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete profile…", exact: true }).click();
    await page.getByRole("button", { name: "Delete profile", exact: true }).click();
    await vi.waitFor(() =>
      expect(useSidebarProfiles.getState().document.profiles.some((p) => p.id === id)).toBe(false),
    );
  });

  it("assigns environment defaults, overrides individual projects and undoes a bulk move", async () => {
    using _setup = await setup();
    await using _screen = await render(<SidebarProfileManager />);
    await act(() => openProfileManager());
    await page.getByRole("button", { name: "Environments", exact: true }).click();
    await page.getByRole("combobox", { name: "Default profile for Test Mac", exact: true }).click();
    await page.getByRole("option", { name: "▣ Work", exact: true }).click();
    await vi.waitFor(() => expect(projectProfile({ environmentId, projectId })).toBe("work"));
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("combobox", {
        name: `Profile for Work repository on ${environmentId}`,
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: "◉ General", exact: true }).click();
    await vi.waitFor(() => expect(projectProfile({ environmentId, projectId })).toBe("general"));
    await page.getByRole("checkbox", { name: /Work repository/ }).click();
    await page.getByRole("combobox", { name: "Move destination", exact: true }).click();
    await page.getByRole("option", { name: "▣ Work", exact: true }).click();
    await page.getByRole("button", { name: "Move 1", exact: true }).click();
    await vi.waitFor(() => expect(projectProfile({ environmentId, projectId })).toBe("work"));
    await page.getByRole("button", { name: "Undo move", exact: true }).click();
    await vi.waitFor(() => expect(projectProfile({ environmentId, projectId })).toBe("general"));
  });
});
