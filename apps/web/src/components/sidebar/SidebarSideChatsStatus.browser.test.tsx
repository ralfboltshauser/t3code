import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { RunId, ThreadId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { environmentThreadShells } from "../../state/threads";
import { makeThreadFixture } from "../../test-fixtures";
import { SidebarSideChatsStatus } from "./SidebarSideChatsStatus";

it("updates the child status breakdown and opens the selected side chat on its parent", async () => {
  using stack = new DisposableStack();
  const registry = stack.adopt(AtomRegistry.make(), (value) => value.dispose());
  const parent = makeThreadFixture();
  const parentRef = scopeThreadRef(parent.environmentId, parent.id);
  const child = makeThreadFixture({
    id: ThreadId.make("child"),
    title: "Side answer",
    lastVisitedAt: "2026-01-01T00:00:00.000Z",
    lineage: {
      parentThreadId: parent.id,
      rootThreadId: parent.id,
      relationshipToParent: "fork",
      sideChat: true,
    },
  });
  const working = {
    ...child,
    runtime: {
      status: "running" as const,
      activeRunId: null,
      providerInstanceId: child.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: child.updatedAt,
    },
  };
  const unread = {
    ...child,
    id: ThreadId.make("unread"),
    title: "Unread answer",
    runtime: null,
    latestRun: {
      runId: RunId.make("run"),
      status: "completed" as const,
      completedAt: "2026-01-02T00:00:00.000Z",
      requestedAt: child.createdAt,
      startedAt: null,
      assistantMessageId: null,
    },
  };
  const approval = {
    ...working,
    id: ThreadId.make("approval"),
    title: "Needs approval",
    hasPendingApprovals: true,
  };
  const atom = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([working, unread, approval]);
  stack.use(vi.spyOn(environmentThreadShells, "sideChatsAtom").mockReturnValue(atom));
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  await using screen = await render(
    <RegistryContext value={registry}>
      <SidebarSideChatsStatus threadRef={parentRef} />
    </RegistryContext>,
  );
  const indicator = screen.getByRole("button", {
    name: /Side chats: 3 chats: 1 needs attention, 1 unread result, 1 working/,
  });
  await expect.element(indicator).toBeVisible();
  await indicator.click();
  await page.getByRole("menuitem", { name: /Unread answer/ }).click();
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe(
      `/${encodeURIComponent(parent.environmentId)}/${parent.id}`,
    ),
  );
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, parentRef)?.id,
  ).toBe("side-chat:unread");
  await act(() => registry.set(atom, [{ ...unread, lastVisitedAt: unread.latestRun.completedAt }]));
  await expect
    .element(screen.getByRole("button", { name: "Side chats: 1 chat: 1 read or idle" }))
    .toBeVisible();
  await act(() => registry.set(atom, []));
  await expect.element(screen.getByRole("button", { name: /Side chats:/ })).not.toBeInTheDocument();
});
