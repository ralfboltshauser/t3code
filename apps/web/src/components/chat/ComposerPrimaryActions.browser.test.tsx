import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { isMacPlatform } from "../../lib/utils";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

it("temporarily replaces Stop with the queued-message action while Mod is held", async () => {
  const onInterrupt = vi.fn();
  const onSendLatestQueuedMessage = vi.fn();
  const props = {
    compact: false,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    showPlanFollowUpPrompt: false,
    promptHasText: false,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onSendLatestQueuedMessage,
    onPreviousPendingQuestion: () => undefined,
    onInterrupt,
    onImplementPlanInNewThread: () => undefined,
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
  } finally {
    await userEvent.keyboard(`{/${modifier}}`);
  }
});
