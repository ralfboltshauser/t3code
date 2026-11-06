import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useQuietThreadShells, useProjects } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
    { mode: "legacy", count: 2, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
      legacySidebarEnabled: scenario.mode === "legacy",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

describe("project Working sections", () => {
  it("folds each project independently and returns actionable work without hiding the current conversation", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    const expansionKey = "t3code:sidebar:project-working-expanded:v1";
    const previousExpansion = localStorage.getItem(expansionKey);
    localStorage.removeItem(expansionKey);
    stack.defer(() => {
      __setClientSettingsForTests(previousSettings);
      if (previousExpansion === null) localStorage.removeItem(expansionKey);
      else localStorage.setItem(expansionKey, previousExpansion);
      vi.mocked(useQuietThreadShells).mockRestore();
      vi.mocked(useThreadRouteTarget).mockRestore();
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: true,
      sidebarWorkingShelfEnabled: true,
    });
    const projects = [project("alpha"), project("beta")];
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    const running = (id: string, projectIndex: number) =>
      makeThreadFixture({
        id: ThreadId.make(id),
        title: id,
        environmentId: projects[projectIndex]!.environmentId,
        projectId: projects[projectIndex]!.id,
        settledOverride: "active",
        runtime: {
          status: "running",
          activeRunId: null,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: null,
          lastError: null,
          updatedAt: "2026-11-05T00:00:00.000Z",
        },
      });
    const alpha = running("Alpha background", 0);
    const beta = running("Beta background", 1);
    vi.mocked(useQuietThreadShells).mockReturnValue([alpha, beta]);
    const ui = () => (
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>
    );
    await using screen = await render(ui());
    const alphaHeader = screen.getByRole("button", {
      name: "Working in alpha, 1 thread",
      exact: true,
    });
    const betaHeader = screen.getByRole("button", {
      name: "Working in beta, 1 thread",
      exact: true,
    });
    await expect.element(alphaHeader).toHaveAttribute("aria-expanded", "false");
    const alphaFolder = screen.getByRole("button", {
      name: "alpha, 1 chat: 1 working",
      exact: true,
    });
    await expect.element(alphaFolder).toBeVisible();
    await expect.element(betaHeader).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByRole("button", { name: /^Alpha background/ }))
      .not.toBeInTheDocument();
    await userEvent.click(alphaHeader);
    await expect.element(screen.getByRole("button", { name: /^Alpha background/ })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /^Beta background/ }))
      .not.toBeInTheDocument();
    await userEvent.click(alphaHeader);
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: { environmentId: alpha.environmentId, threadId: alpha.id },
    });
    await screen.rerender(ui());
    await expect.element(screen.getByRole("button", { name: /^Alpha background/ })).toBeVisible();
    await expect.element(alphaHeader).toHaveAttribute("aria-expanded", "false");
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    vi.mocked(useQuietThreadShells).mockReturnValue([
      alpha,
      { ...beta, hasPendingUserInput: true },
    ]);
    await screen.rerender(ui());
    await expect
      .element(screen.getByRole("button", { name: /^Alpha background/ }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /^Beta background/ })).toBeVisible();
    await expect.element(betaHeader).not.toBeInTheDocument();
    await expect.element(alphaHeader).toHaveAttribute("aria-expanded", "false");
    const betaFolder = screen.getByRole("button", {
      name: "beta, 1 chat: 1 needs attention",
      exact: true,
    });
    await expect.element(betaFolder).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(betaFolder);
    await expect.element(betaFolder).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByRole("button", { name: /^Beta background/ }))
      .not.toBeInTheDocument();
    await userEvent.click(betaFolder);
    await expect.element(betaFolder).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByRole("button", { name: /^Beta background/ })).toBeVisible();
  });
});
