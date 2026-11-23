import {
  EnvironmentId,
  NodeId,
  PlanId,
  ProjectId,
  RunId,
  ThreadId,
  type ScopedThreadRef,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const SCRATCH_ROOT = "/home/user/.t3/scratch";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  folder: "",
  pullRequests: [] as unknown[],
  configLoaded: true,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "project",
          environmentId: "environment",
          title: state.workspaceRoot === SCRATCH_ROOT ? "No project" : "plain",
          workspaceRoot: state.workspaceRoot,
          scripts: [],
        }) as never,
  useProjects: (() => []) as never,
  useQuietThreadShell: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "thread",
          environmentId: "environment",
          projectId: "project",
          worktreePath: state.folder,
          branch: null,
          pullRequests: state.pullRequests,
        }) as never,
  useServerConfigs: (() =>
    new Map(
      state.configLoaded
        ? [
            [
              EnvironmentId.make("environment"),
              {
                scratchWorkspaceRoot: SCRATCH_ROOT,
                environment: { capabilities: { pullRequests: true } },
              },
            ],
          ]
        : [],
    )) as never,
}));
// Neither folder is a repository, which is what the server reports for both.
vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const notARepo = Atom.make(
    AsyncResult.success({
      isRepo: false,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: 0,
      pr: null,
    }),
  );
  return {
    ...actual,
    vcsEnvironment: { ...actual.vcsEnvironment, status: (() => notARepo) as never },
  };
});

import { render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { PopoverCreateHandle } from "../ui/popover";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout } from "./chatCanvasLayout";
import { ThreadDetailsPanel } from "./ThreadDetailsPanel";
import type { TaskListPlan } from "../../session-logic";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const container = { width: 1200, height: 800 };
const placement = { x: 908, y: 0, right: 12, width: 280, height: 400 } as const;
const linkedPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "pingdotgg/t3code",
  number: 27513,
  url: "https://github.com/pingdotgg/t3code/pull/27513",
  source: "manual",
  linkedAt: "2026-10-30T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

function setup(input: {
  workspaceRoot: string;
  folder: string;
  pullRequests?: ThreadPullRequestLink[];
  configLoaded?: boolean;
}) {
  state.configLoaded = input.configLoaded ?? true;
  state.workspaceRoot = input.workspaceRoot;
  state.folder = input.folder;
  state.pullRequests = input.pullRequests ?? [];
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  const anchor = document.createElement("div");
  document.body.append(anchor);
  return {
    anchor: { current: anchor },
    handle: PopoverCreateHandle(),
    [Symbol.dispose]: () => anchor.remove(),
  };
}

function Panel({
  fixture,
  taskList,
  activeRunId = null,
}: {
  fixture: ReturnType<typeof setup>;
  taskList?: TaskListPlan;
  activeRunId?: RunId | null;
}) {
  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;
  return (
    <ChatCanvasContext
      value={{
        container,
        lane: { padding: 48, minChatWidth: 640 },
        layout: resolveChatCanvasLayout({ container, preview: null }),
        previewKey: null,
        registerTimeline: noop,
        measureDetailsCard: noop,
        detailsCardTopInset: 0,
        preferredDetailsCard: placement,
        detailsCardPlacement: placement,
      }}
    >
      <ThreadDetailsPanel
        anchor={fixture.anchor}
        handle={fixture.handle}
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        projectId={ProjectId.make("project")}
        composerDraftTarget={threadRef}
        worktreePath={state.folder}
        isServerThread
        activeProjectName={state.workspaceRoot === SCRATCH_ROOT ? "No project" : "plain"}
        activeProjectScripts={undefined}
        preferredScriptId={null}
        keybindings={[]}
        availableEditors={[]}
        showOpenInPicker={false}
        openInShortcutEnabled={false}
        gitCwd={state.folder}
        workspaceMutationId={null}
        isGitRepo={false}
        envLocked
        availableEnvironments={[]}
        onEnvModeChange={noop}
        envMode="local"
        startFromOrigin={false}
        onStartFromOriginChange={noop}
        onComposerFocusRequest={noop}
        onRunProjectScript={noop}
        onAddProjectScript={scriptResult}
        onUpdateProjectScript={scriptResult}
        onDeleteProjectScript={scriptResult}
        taskList={taskList ?? null}
        currentTaskRunId={activeRunId}
        usage={{} as never}
      />
    </ChatCanvasContext>
  );
}

it("opens the checklist when tasks arrive and keeps a manually collapsed list collapsed", async () => {
  using fixture = setup({ workspaceRoot: "/work/plain", folder: "/work/plain" });
  const runId = RunId.make("run");
  const plan: TaskListPlan = {
    id: PlanId.make("tasks"),
    threadId: threadRef.threadId,
    runId,
    nodeId: NodeId.make("tasks"),
    kind: "todo_list",
    status: "active",
    steps: [
      { id: "inspect", text: "Inspect files", status: "completed" },
      { id: "test", text: "Run tests", status: "running" },
    ],
  };
  await using screen = await render(<Panel fixture={fixture} />);
  const tasks = page.getByRole("button", { name: /Agent tasks/ });
  await expect.element(tasks).not.toBeInTheDocument();

  await screen.rerender(<Panel fixture={fixture} taskList={plan} activeRunId={runId} />);
  await expect.element(tasks).toHaveAttribute("aria-expanded", "true");
  await expect.element(page.getByText("Run tests", { exact: false })).toBeVisible();
  await tasks.click();
  await expect.element(tasks).toHaveAttribute("aria-expanded", "false");

  await screen.rerender(
    <Panel
      fixture={fixture}
      taskList={{
        ...plan,
        steps: plan.steps.map((step) => ({ ...step, status: "completed" })),
      }}
      activeRunId={RunId.make("next")}
    />,
  );
  const lastChecklist = page.getByRole("button", { name: /Last checklist.*2 of 2 completed/ });
  await expect.element(lastChecklist).toHaveAttribute("aria-expanded", "false");
  await lastChecklist.click();
  await expect.element(page.getByText("Run tests", { exact: false })).toBeVisible();
});

it("offers no git controls in a No project thread, but shows its linked pull request", async () => {
  using fixture = setup({
    workspaceRoot: SCRATCH_ROOT,
    folder: `${SCRATCH_ROOT}/thread`,
    pullRequests: [linkedPullRequest],
  });
  await using _screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByText("#27513")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Initialize Git" }))
    .not.toBeInTheDocument();
});

it("shows a linked pull request in a folder that is not a git repository", async () => {
  using fixture = setup({
    workspaceRoot: "/work/plain",
    folder: "/work/plain",
    pullRequests: [linkedPullRequest],
  });
  await using _screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByRole("region", { name: "Workspace" })).toBeVisible();
  await expect.element(page.getByText("#27513")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Initialize Git" })).toBeVisible();
});

it("offers no Initialize Git before the server config says where No project lives", async () => {
  using fixture = setup({
    workspaceRoot: SCRATCH_ROOT,
    folder: `${SCRATCH_ROOT}/thread`,
    configLoaded: false,
  });
  await using _screen = await render(<Panel fixture={fixture} />);
  await expect.element(page.getByRole("region", { name: "Workspace" })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Initialize Git" }))
    .not.toBeInTheDocument();
});
