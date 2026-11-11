import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { makeThreadFixture } from "../test-fixtures";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS } from "./Sidebar.logic";
import { SortableThreadRow } from "./sidebar/SidebarThreadRow";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { SidebarProjectFolderHeader } from "./sidebar/SidebarProjectFolderHeader";
import { resolveSidebarProjectHosts } from "./sidebar/sidebarProjectHosts";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("./sidebar/SidebarThreadRow", { spy: true });
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  // The desktop defaults: holding Mod alone already matches a thread jump.
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+1", command: "thread.jump.1" },
    { key: "mod+2", command: "thread.jump.2" },
  ]);
  return { ...(await original()), primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
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
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
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
      defaultProjectFallbackReady: true,
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
  it.each(["Working", "Read"] as const)(
    "folds %s per project and returns actionable work without hiding the current conversation",
    async (section) => {
      using stack = new DisposableStack();
      const previousSettings = getClientSettings();
      const expansionKey = `t3code:sidebar:project-${section.toLowerCase()}-expanded:v1`;
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
          runtime:
            section === "Read"
              ? null
              : {
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
        name: `${section} in alpha, 1 thread`,
        exact: true,
      });
      const betaHeader = screen.getByRole("button", {
        name: `${section} in beta, 1 thread`,
        exact: true,
      });
      await expect.element(alphaHeader).toHaveAttribute("aria-expanded", "false");
      const alphaFolder = screen.getByRole("button", {
        name: `alpha, 1 chat: 1 ${section === "Read" ? "read or idle" : "working"}`,
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
    },
  );
});

it("reveals the project host on hover and focus while keeping the new-chat action separate", async () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote-mini");
  const [group] = buildSidebarProjectSnapshots({
    projects: [{ ...project("zli"), environmentId: remote }],
    settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: local,
    resolveEnvironmentLabel: () => "Mac mini",
  });
  const onToggle = vi.fn();
  const onNewThread = vi.fn();
  await using screen = await render(
    <ul>
      <SidebarProjectFolderHeader
        group={group!}
        collapsed={false}
        threads={[makeThreadFixture({ environmentId: remote, projectId: group!.id })]}
        hostPresentation={resolveSidebarProjectHosts({
          members: group!.memberProjects,
          primaryEnvironmentId: local,
          catalog: new Map(),
          catalogReady: true,
          machineByEnvironmentId: new Map([[remote, "mac-mini"]]),
        })}
        onToggle={onToggle}
        onNewThread={onNewThread}
        onContextMenu={() => {}}
      />
    </ul>,
  );
  const folder = screen.getByRole("button", { name: /^zli, 1 chat:/ });
  await userEvent.hover(folder);
  await expect.element(page.getByText("Mac mini", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Read or idle", { exact: true })).toBeVisible();
  await expect.element(folder).toHaveAttribute("aria-description", "On Mac mini");
  await userEvent.unhover(folder);
  await expect.element(page.getByText("Mac mini", { exact: true })).not.toBeInTheDocument();
  await userEvent.tab();
  await expect.element(folder).toHaveFocus();
  await expect.element(page.getByText("Mac mini", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "New thread in zli", exact: true }));
  expect(onNewThread).toHaveBeenCalledOnce();
  expect(onToggle).not.toHaveBeenCalled();
});

function threadShell(projectId: ProjectId, index: number): EnvironmentThreadShell {
  return makeThreadFixture({
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make(`thread-${index}`),
    projectId,
    title: `Thread ${index}`,
  });
}

describe("sidebar render isolation", () => {
  // regression: #33100 Cmd+J re-rendered every sidebar row, which took hundreds of ms with many threads
  it("does not re-render thread rows when a quick Mod shortcut opens and focuses the terminal", async () => {
    using stack = new DisposableStack();
    const activeProject = project("active");
    const threads = Array.from({ length: 5 }, (_, index) => threadShell(activeProject.id, index));
    const routeThreadRef: ScopedThreadRef = {
      environmentId: activeProject.environmentId,
      threadId: threads[0]!.id,
    };
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef,
    });
    const terminal = document.createElement("div");
    terminal.dataset.terminalOwner = "drawer";
    const terminalInput = document.createElement("textarea");
    terminal.append(terminalInput);
    document.body.append(terminal);
    stack.defer(() => terminal.remove());
    stack.defer(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, false));
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("Thread 4").first()).toBeInTheDocument();
    const rowRenders = () => vi.mocked(SortableThreadRow).mock.calls.length;

    using _timers = fakeTimers();
    const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    const beforeShortcut = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, true));
    await act(() => terminalInput.focus());
    await userEvent.keyboard(`{/${modifier}}`);
    await act(() => terminalInput.blur());
    expect(
      rowRenders() - beforeShortcut,
      "thread rows re-rendered while opening the terminal with a quick Mod shortcut",
    ).toBe(0);

    const jumpLabelsSince = (start: number) =>
      vi
        .mocked(SortableThreadRow)
        .mock.calls.slice(start)
        .map(([props]) => props.jumpLabel)
        .filter((label) => label !== null);
    const beforeHold = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
    expect(jumpLabelsSince(beforeHold), "holding Mod showed no jump hints").toHaveLength(2);
    const beforeRelease = rowRenders();
    await userEvent.keyboard(`{/${modifier}}`);
    expect(rowRenders()).toBeGreaterThan(beforeRelease);
    expect(jumpLabelsSince(beforeRelease)).toEqual([]);
  });
});
