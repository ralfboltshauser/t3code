import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  RunId,
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationV2DispatchCommandError,
  ThreadId,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import {
  formatComposerContextReference,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { createRef, Profiler, useState, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  threadState: null as unknown as Atom.Writable<AsyncResult.AsyncResult<EnvironmentThreadState>>,
  workflow: null as unknown,
  commandResult: undefined as unknown,
  projection: undefined as unknown,
  dispatch: vi.fn(async (_input: unknown): Promise<unknown> => undefined),
}));

vi.mock(import("@t3tools/client-runtime/state/thread-workflows"), async (importOriginal) => ({
  ...(await importOriginal()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    useQuietThreadProjection: ((...args: Parameters<typeof original.useQuietThreadProjection>) => {
      const actual = original.useQuietThreadProjection(...args);
      return state.projection === undefined ? actual : state.projection;
    }) as never,
    useQuietThreadShell: ((target: { readonly environmentId: string } | null) =>
      target === null || target.environmentId === "environment:linked"
        ? null
        : { title: "Release lead" }) as never,
  };
});

vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironment: ((environmentId: string | null) =>
    environmentId === "environment:linked" ? { environmentId } : null) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [{ id: "task:webhook", title: "PR dispatcher" }] },
  })) as never,
}));

// The thread detail atoms are real, fed by one state atom the test writes.
vi.mock(import("../../state/threads"), async (importOriginal) => {
  const { createEnvironmentThreadDetailAtoms, EMPTY_ENVIRONMENT_THREAD_STATE } =
    await import("@t3tools/client-runtime/state/threads");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const { makeThreadProjectionFixture } = await import("../../test-fixtures");
  state.threadState = Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState>>(
    AsyncResult.success({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some(makeThreadProjectionFixture()),
    }),
  ).pipe(Atom.keepAlive);
  const original = await importOriginal();
  return {
    ...original,
    environmentThreadDetails: createEnvironmentThreadDetailAtoms(() => state.threadState),
  };
});

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: (() => state.dispatch) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import "~/index.css";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";

import { act, render as renderUi } from "../../../test/render";
import { makeStreamingTimelineFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import { ToastProvider } from "../ui/toast";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./QueuedRunsControl";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

function setup() {
  state.workflow = null;
  state.projection = undefined;
  state.commandResult = undefined;
  state.dispatch.mockReset();
  state.dispatch.mockImplementation(async () => state.commandResult);
}

const baseProps = {
  environmentId: "environment:test" as never,
  optimisticMessages: [],
  threadId: "thread:test" as never,
  editingRunId: null,
  editBlockedReason: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
  timestampFormat: "locale",
  onOpenThread: () => undefined,
  onImageExpand: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

async function renderQueue(props: Partial<ComponentProps<typeof QueuedRunsControl>> = {}) {
  return renderUi(<QueuedRunsControl {...baseProps} {...props} />);
}

it.each([false, true])(
  "opens queued images in the existing gallery, pending=%s",
  async (pending) => {
    setup();
    const attachments = ["first.png", "second.png"].map((name) => ({
      type: "image" as const,
      id: name,
      name,
      mimeType: "image/png",
      sizeBytes: 128,
    }));
    state.workflow = {
      activeRun: null,
      queuedRuns: pending
        ? []
        : [
            {
              run: { id: "run:queued", userMessageId: "message:queued" },
              text: "Later",
              attachments,
            },
          ],
    };
    function QueueWithGallery() {
      const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);
      return (
        <>
          <QueuedRunsControl
            {...baseProps}
            optimisticMessages={
              pending
                ? [
                    {
                      id: MessageId.make("message:pending"),
                      inputIntent: "queued_turn",
                      text: "Later",
                      attachments: attachments.map((attachment) => ({
                        ...attachment,
                        previewUrl: `https://assets.test/${attachment.id}`,
                      })),
                    },
                  ]
                : []
            }
            onImageExpand={setPreview}
          />
          {preview ? (
            <ExpandedImageDialog preview={preview} onClose={() => setPreview(null)} />
          ) : null}
        </>
      );
    }
    await using _screen = await renderUi(<QueueWithGallery />);

    await page.getByRole("button", { name: "Preview second.png", exact: true }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.element(page.getByText("second.png (2/2)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous media", exact: true }).click();
    await expect.element(page.getByText("first.png (1/2)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close image preview", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByText("Later", { exact: true })).toBeVisible();
  },
);

it("previews assistant quotes as readable text and preserves the citation when editing", async () => {
  setup();
  const quotedText = "Cache the parsed config per worktree.";
  const quote = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment:test"),
    threadId: ThreadId.make("thread:test"),
    messageId: MessageId.make("message:assistant"),
    text: quotedText,
    start: 0,
    end: quotedText.length,
    prefix: "",
    suffix: "",
  });
  const quoteAndText = `${quote}\n\nWhy per worktree?`;
  const inlineImage = formatComposerContextReference({
    kind: "image",
    contextId: toComposerContextId("header"),
    label: "header.png",
  });
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:quote-only", userMessageId: "message:quote-only" },
        text: quote,
        attachments: [],
      },
      {
        run: { id: "run:quote-and-text", userMessageId: "message:quote-and-text" },
        text: quoteAndText,
        attachments: [],
      },
      {
        run: { id: "run:inline-image", userMessageId: "message:inline-image" },
        text: `Make the header look like ${inlineImage} and keep the logo.`,
        attachments: [{ type: "image", id: "attachment:header", name: "header.png" }],
      },
    ],
  };
  const onEditQueuedRun = vi.fn();
  await using _screen = await renderQueue({ onEditQueuedRun });

  await expect.element(page.getByText(quotedText, { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(`${quotedText} Why per worktree?`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("Make the header look like header.png and keep the logo.", { exact: true }),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).nth(1).click();
  expect(onEditQueuedRun).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: quoteAndText }),
  );
});

it("shows who sent a queued message and folds automation and agent prompts", async () => {
  setup();
  const message = (id: string, fields: Record<string, unknown>) => ({
    id,
    role: "user",
    createdAt: DateTime.makeUnsafe("2026-10-27T12:00:00.000Z"),
    ...fields,
  });
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      [
        "run:automation",
        "GitHub labeled a pull request.\nFollow the runbook.",
        {
          createdBy: "agent",
          scheduledTaskId: "task:webhook",
        },
      ],
      [
        "run:agent",
        "Review finished.",
        {
          createdBy: "agent",
          creationSource: "provider",
          senderThreadId: "thread:lead",
        },
      ],
      [
        "run:linked",
        "Linked review finished.",
        {
          createdBy: "agent",
          creationSource: "mcp",
          linkedSender: {
            environmentId: "environment:linked",
            threadId: "thread:linked-lead",
            title: "Title when sent",
          },
        },
      ],
      [
        "run:server",
        "Continue where you left off.",
        {
          createdBy: "agent",
          creationSource: "server",
        },
      ],
    ].map(([runId, text, fields]) => ({
      run: { id: runId, userMessageId: `${runId}:message` },
      text,
      attachments: [],
      message: message(`${runId}:message`, { text, ...(fields as object) }),
    })),
  };
  const onOpenThread = vi.fn();
  await using _screen = await renderQueue({ onOpenThread });
  // Four rows collapse the queue.
  await page.getByRole("button", { name: "Show all 4 queued" }).click();

  const automation = page.getByRole("button", { name: /PR dispatcher/ });
  await expect.element(automation).toHaveAttribute("aria-expanded", "false");
  await expect.element(page.getByText(/Follow the runbook/)).not.toBeInTheDocument();
  await automation.click();
  await expect.element(page.getByText(/Follow the runbook/)).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Open automation" })).toBeInTheDocument();

  await expect.element(page.getByRole("button", { name: /Release lead/ })).toBeVisible();
  await page.getByRole("button", { name: "Open thread" }).nth(0).click({ force: true });
  expect(onOpenThread).toHaveBeenCalledExactlyOnceWith("thread:lead", "environment:test");
  // A sender in a connected linked environment keeps the title it sent and opens there.
  await expect.element(page.getByRole("button", { name: /Title when sent/ })).toBeVisible();
  await page.getByRole("button", { name: "Open thread" }).nth(1).click({ force: true });
  expect(onOpenThread).toHaveBeenLastCalledWith("thread:linked-lead", "environment:linked");

  await expect.element(page.getByText("Sent by T3 Code")).toBeVisible();
  await expect.element(page.getByText("Continue where you left off.")).toBeVisible();
});

it("stays inside the timeline scroller instead of growing the chat column", async () => {
  setup();
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Later",
        attachments: [],
      },
    ],
  };
  // Mirrors ChatView: a scrollable column, a positioned wrapper, then a non-positioned scroller.
  await using screen = await renderUi(
    <div data-testid="column" style={{ height: 200, overflowY: "auto" }}>
      <div style={{ position: "relative", height: "100%" }}>
        <div style={{ height: "100%", overflowY: "auto" }}>
          <div style={{ height: 1000 }} />
          <QueuedRunsControl {...baseProps} />
        </div>
      </div>
    </div>,
  );
  await expect.element(page.getByText("Later", { exact: true })).toBeInTheDocument();
  const column = screen.getByTestId("column").element();
  expect(column.scrollHeight).toBe(column.clientHeight);
});

it("does not re-render while assistant text streams into the thread", async () => {
  setup();
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Run the tests next",
        attachments: [],
      },
    ],
  };
  const base = makeThreadProjectionFixture();
  // Each delta replaces only the streaming reply; every other item keeps its identity.
  const timeline = makeStreamingTimelineFixture().visibleTurnItems;
  const thread = (text: string, done = false) => {
    const items = timeline.map((entry) =>
      entry.item.type === "assistant_message" && entry.item.streaming
        ? {
            ...entry,
            item: done
              ? { ...entry.item, text, streaming: false, status: "completed" as const }
              : { ...entry.item, text },
          }
        : entry,
    );
    return AsyncResult.success<EnvironmentThreadState>({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some({
        ...base,
        turnItems: items.map(({ item }) => item),
        visibleTurnItems: items,
      }),
    });
  };
  const registry = AtomRegistry.make();
  await using stack = new AsyncDisposableStack();
  stack.defer(() => registry.dispose());
  registry.set(state.threadState, thread("Hel"));
  let renders = 0;
  await using _screen = await renderUi(
    <RegistryContext.Provider value={registry}>
      <Profiler id="queue" onRender={() => (renders += 1)}>
        <QueuedRunsControl {...baseProps} />
      </Profiler>
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText("Run the tests next", { exact: true })).toBeVisible();
  const settled = renders;

  await act(() => registry.set(state.threadState, thread("Hello")));
  await act(() => registry.set(state.threadState, thread("Hello there")));
  expect(renders).toBe(settled);

  await act(() => registry.set(state.threadState, thread("Hello there", true)));
  expect(renders).toBeGreaterThan(settled);
});

it("tells the user why Send now was rejected", async () => {
  setup();
  const reason = "Target run run:active is stopping and cannot be steered.";
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Follow up",
        attachments: [],
      },
    ],
  };
  state.commandResult = AsyncResult.failure(
    Cause.fail(
      new OrchestrationV2DispatchCommandError({
        commandId: CommandId.make("command:promote"),
        commandType: "queued-message.promote-to-steer",
        message: reason,
        detail: reason,
      }),
    ),
  );
  await using _screen = await renderUi(
    <ToastProvider timeout={0}>
      <QueuedRunsControl {...baseProps} />
    </ToastProvider>,
  );

  await page.getByRole("button", { name: "Send now" }).click();
  await vi.waitFor(() => expect(page.getByText(reason).element()).toBeVisible());
});

function queuedWorkflow() {
  return {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [1, 2].map((ordinal) => ({
      run: {
        id: RunId.make(`run:${ordinal}`),
        userMessageId: MessageId.make(`message:${ordinal}`),
        ordinal,
      },
      text: `Queued ${ordinal}`,
      attachments: [],
    })),
  };
}

it("sends the newest queued message through Send now without duplicate dispatches", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  const workflow = queuedWorkflow();
  // Queue order can differ from submission order.
  workflow.queuedRuns.reverse();
  state.workflow = workflow;
  let resolveDispatch!: () => void;
  const dispatch = new Promise<void>((resolve) => {
    resolveDispatch = resolve;
  });
  state.dispatch.mockImplementation(() => dispatch);
  const ref = createRef<QueuedRunsControlHandle>();
  await using _screen = await renderQueue({ ref });

  expect(ref.current?.sendLatest()).toBe(true);
  expect(ref.current?.sendLatest()).toBe(true);
  resolveDispatch();
  await vi.waitFor(() =>
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      environmentId: baseProps.environmentId,
      input: {
        threadId: baseProps.threadId,
        queuedRunId: "run:2",
        targetRunId: "run:active",
      },
    }),
  );
});

it("waits for the exact optimistic message instead of sending an older queued row", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  const workflow = queuedWorkflow();
  state.workflow = workflow;
  const ref = createRef<QueuedRunsControlHandle>();
  const optimistic = {
    id: MessageId.make("message:pending"),
    inputIntent: "queued_turn" as const,
    text: "Latest message",
  };
  const props = { ref, optimisticMessages: [optimistic] };
  await using screen = await renderQueue(props);

  expect(ref.current?.sendLatest()).toBe(true);
  expect(ref.current?.sendLatest()).toBe(true);
  expect(state.dispatch).not.toHaveBeenCalled();

  state.projection = { projection: { messages: [{ id: optimistic.id }] } };
  state.workflow = {
    ...workflow,
    queuedRuns: [
      ...workflow.queuedRuns,
      {
        run: { id: "run:pending", userMessageId: optimistic.id, ordinal: 3 },
        text: optimistic.text,
        attachments: [],
      },
    ],
  };
  await screen.rerender(<QueuedRunsControl {...baseProps} {...props} />);
  await vi.waitFor(() =>
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      environmentId: baseProps.environmentId,
      input: {
        threadId: baseProps.threadId,
        queuedRunId: "run:pending",
        targetRunId: "run:active",
      },
    }),
  );
});

it.each(["removed", "target changed", "thread changed"])(
  "drops pending promotion when the message is %s",
  async (change) => {
    setup();
    state.projection = { projection: { messages: [] } };
    const workflow = queuedWorkflow();
    state.workflow = workflow;
    const ref = createRef<QueuedRunsControlHandle>();
    const optimistic = {
      id: MessageId.make("message:pending"),
      inputIntent: "queued_turn" as const,
      text: "Latest message",
    };
    await using screen = await renderQueue({ ref, optimisticMessages: [optimistic] });
    expect(ref.current?.sendLatest()).toBe(true);
    const nextProps = {
      ...baseProps,
      ref,
      threadId: change === "thread changed" ? ThreadId.make("thread:other") : baseProps.threadId,
      optimisticMessages: change === "removed" ? [] : [optimistic],
    };
    state.workflow = {
      ...workflow,
      activeRun: { id: change === "target changed" ? "run:other" : "run:active" },
    };
    await screen.rerender(<QueuedRunsControl {...nextProps} />);
    state.projection = { projection: { messages: [{ id: optimistic.id }] } };
    state.workflow = {
      ...workflow,
      queuedRuns: [
        {
          run: { id: "run:pending", userMessageId: optimistic.id, ordinal: 3 },
          text: optimistic.text,
          attachments: [],
        },
      ],
    };
    await screen.rerender(<QueuedRunsControl {...nextProps} />);
    expect(state.dispatch).not.toHaveBeenCalled();
  },
);

it.each(["fresh context", "unsupported steering", "editing", "question"])(
  "keeps the message queued during %s",
  async (block) => {
    setup();
    state.projection = { projection: { messages: [] } };
    const workflow = queuedWorkflow();
    state.workflow = {
      ...workflow,
      canPromoteToSteer: block !== "unsupported steering",
      queuedRuns: workflow.queuedRuns.map((entry) => ({
        ...entry,
        run: { ...entry.run, freshContext: block === "fresh context" },
      })),
    };
    const ref = createRef<QueuedRunsControlHandle>();
    await using screen = await renderQueue({
      ref,
      editingRunId: block === "editing" ? RunId.make("run:2") : null,
      editBlockedReason: block === "question" ? "Answer the question first" : null,
    });
    expect(ref.current?.sendLatest()).toBe(false);
    expect(state.dispatch).not.toHaveBeenCalled();
    await expect.element(screen.getByText("Queued 2", { exact: true })).toBeVisible();
  },
);
