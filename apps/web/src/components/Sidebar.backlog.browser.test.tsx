import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/index.css";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("parks a thread in Backlog and restores it without disturbing timed snoozes", async () => {
  await page.viewport(1400, 900);
  const [first, second] = [
    threadWithHistory("customer-feedback", 1),
    threadWithHistory("reminder", 1),
  ];
  using _environment = installFakeEnvironment([first, second], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  const firstRow = page.getByRole("button", { name: new RegExp(`^${first.title},`) });
  await expect.element(firstRow).toBeVisible();
  await userEvent.hover(firstRow);
  const firstSnooze = firstRow.getByRole("button", { name: "Snooze thread", exact: true });
  firstSnooze.element().focus();
  await expect.element(firstSnooze).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(firstSnooze).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(
    page.getByRole("menuitem", { name: "Indefinitely (Backlog)", exact: true }),
  );
  const backlogHeader = page.getByTestId("sidebar-backlog-shelf-toggle");
  await expect.element(backlogHeader).toBeVisible();
  await userEvent.click(backlogHeader);
  await userEvent.click(firstRow);
  await expect
    .element(page.getByText("In backlog until you restore it", { exact: true }))
    .toBeVisible();
  const secondRow = page.getByRole("button", { name: new RegExp(`^${second.title},`) });
  await userEvent.hover(secondRow);
  const secondSnooze = secondRow.getByRole("button", { name: "Snooze thread", exact: true });
  secondSnooze.element().focus();
  await expect.element(secondSnooze).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(secondSnooze).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(page.getByRole("menuitem", { name: /^In 1 hour/ }));
  await expect.element(page.getByTestId("sidebar-snoozed-shelf-toggle")).toBeVisible();
  await expect.element(backlogHeader).toBeVisible();
  await userEvent.click(firstRow);
  await userEvent.click(page.getByRole("button", { name: "Restore", exact: true }));
  await expect.element(backlogHeader).not.toBeInTheDocument();
  await expect.element(firstRow).toBeVisible();
  await expect.element(page.getByTestId("sidebar-snoozed-shelf-toggle")).toBeVisible();
});
