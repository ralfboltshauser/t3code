import "~/index.css";

import type { ComponentProps } from "react";
import { userEvent } from "vite-plus/test/browser";
import { isMacPlatform } from "../../lib/utils";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
  useClientSettings: () => false,
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

function setup() {
  return {
    compact: true,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    canResume: false,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onPreviousPendingQuestion: vi.fn(),
    onInterrupt: vi.fn(),
    onResume: vi.fn(),
    onSubmitMessage: vi.fn(),
  } satisfies ComponentProps<typeof ComposerPrimaryActions>;
}

it.each([false, true])(
  "keeps repeat clicks away from Resume and Send (draft: %s)",
  async (draft) => {
    const props = setup();
    const container = document.createElement("div");
    Object.assign(container.style, { display: "flex", justifyContent: "flex-end", width: "400px" });
    await using screen = await render(<ComposerPrimaryActions {...props} />, { container });
    const stop = screen
      .getByRole("button", { name: "Stop generation" })
      .element() as HTMLButtonElement;
    const { x, y, width, height } = stop.getBoundingClientRect();
    const target = () =>
      document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button");
    await act(() => stop.click());
    await act(() =>
      (
        screen.getByRole("button", { name: "Stopping", exact: true }).element() as HTMLButtonElement
      ).click(),
    );
    await expect
      .element(screen.getByRole("button", { name: "Stopping", exact: true }))
      .toBeDisabled();
    expect(props.onInterrupt).toHaveBeenCalledTimes(1);
    await screen.rerender(
      <ComposerPrimaryActions
        {...props}
        isRunning={false}
        canInterrupt={false}
        canResume
        hasSendableContent={draft}
      />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Stopped", exact: true }))
      .toBeDisabled();
    expect(target()).toHaveAttribute("aria-label", "Stopped");
    await act(() => {
      for (let i = 0; i < 20; i++) target()?.click();
    });
    expect(props.onResume).not.toHaveBeenCalled();
    expect(props.onSubmitMessage).not.toHaveBeenCalled();
    const action = screen
      .getByRole("button", { name: draft ? "Submit message" : "Resume thread" })
      .element() as HTMLButtonElement;
    await act(() => action.click());
    expect(draft ? props.onSubmitMessage : props.onResume).toHaveBeenCalledTimes(1);
    await screen.rerender(<ComposerPrimaryActions {...props} />);
    await expect.element(screen.getByRole("button", { name: "Stop generation" })).toBeEnabled();
  },
);

it("allows retry after ten seconds and protects a late stop", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} />);
  using _timers = fakeTimers();
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await act(() => vi.advanceTimersByTime(9_999));
  expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
  await act(() => vi.advanceTimersByTime(1));
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(
    <ComposerPrimaryActions {...props} isRunning={false} canInterrupt={false} canResume />,
  );
  expect(screen.getByRole("button", { name: "Stopped", exact: true }).element()).toBeDisabled();
  expect(props.onInterrupt).toHaveBeenCalledTimes(2);
  expect(props.onResume).not.toHaveBeenCalled();
});

it("keeps Stop pending across a permission failure", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} />);
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(
    <ComposerPrimaryActions {...props} canOperateThread={false} canInterrupt={false} />,
  );
  await screen.rerender(<ComposerPrimaryActions {...props} />);
  await expect
    .element(screen.getByRole("button", { name: "Stopping", exact: true }))
    .toBeDisabled();
  expect(props.onInterrupt).toHaveBeenCalledTimes(1);
});

it("keeps a pending stop when the run id clears and resets it for a different run", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} runId="first" />);
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(<ComposerPrimaryActions {...props} runId={null} />);
  expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
  await screen.rerender(<ComposerPrimaryActions {...props} runId="second" />);
  expect(screen.getByRole("button", { name: "Stop generation" }).element()).toBeEnabled();
});

it("temporarily replaces Stop with the queued-message action while Mod is held", async () => {
  const onInterrupt = vi.fn();
  const onSendLatestQueuedMessage = vi.fn();
  const props = {
    compact: false,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onSendLatestQueuedMessage,
    onPreviousPendingQuestion: () => undefined,
    onInterrupt,
  } satisfies ComponentProps<typeof ComposerPrimaryActions>;
  await using screen = await render(<ComposerPrimaryActions {...props} />);
  const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
  await expect.element(screen.getByRole("button", { name: "Stop generation" })).toBeVisible();

  try {
    await userEvent.keyboard(`{${modifier}>}`);
    const send = screen.getByRole("button", { name: "Send latest queued message" });
    await expect.element(send).toBeEnabled();
    await send.click();
    expect(onSendLatestQueuedMessage).toHaveBeenCalledOnce();
    expect(onInterrupt).not.toHaveBeenCalled();
    await userEvent.keyboard(`{/${modifier}}`);
    await expect.element(screen.getByRole("button", { name: "Stop generation" })).toBeVisible();

    await screen.rerender(
      <ComposerPrimaryActions {...props} onSendLatestQueuedMessage={undefined} />,
    );
    await userEvent.keyboard(`{${modifier}>}`);
    await expect.element(screen.getByRole("button", { name: "Stop generation" })).toBeVisible();
    await userEvent.keyboard(`{/${modifier}}`);
    await screen.rerender(<ComposerPrimaryActions {...props} />);
    await screen.getByRole("button", { name: "Stop generation" }).click();
    await userEvent.keyboard(`{${modifier}>}`);
    await expect
      .element(screen.getByRole("button", { name: "Stopping", exact: true }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Send latest queued message" }).click();
    expect(onInterrupt).toHaveBeenCalledOnce();
    expect(onSendLatestQueuedMessage).toHaveBeenCalledTimes(2);
  } finally {
    await userEvent.keyboard(`{/${modifier}}`);
  }
});
