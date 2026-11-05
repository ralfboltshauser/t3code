import "../index.css";
import { transactSidebarProfiles } from "../sidebarProfilesStorage";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render, act } from "../../test/render";
import { useSidebarProfiles, openProfileManager, projectProfile } from "../sidebarProfiles";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { SidebarProvider } from "./ui/sidebar";
import { SidebarProfileManager, SidebarProfileRail } from "./SidebarProfiles";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";

vi.mock("../state/entities", { spy: true });
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
    },
  };
}
describe("sidebar profile integration", () => {
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
});
