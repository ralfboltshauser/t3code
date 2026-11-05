import { RegistryContext } from "@effect/atom-react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  applySidebarProfileMutation,
  defaultSidebarProfiles,
} from "@t3tools/client-runtime/sidebar-profiles";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ set: (_value: string) => {} }));
vi.mock("./preferences", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const atom = Atom.make(AsyncResult.success({ sidebarProfiles: "" }));
  const { appAtomRegistry } = await import("./atom-registry");
  fixture.set = (value) =>
    appAtomRegistry.set(atom, AsyncResult.success({ sidebarProfiles: value }));
  return { mobilePreferencesAtom: atom };
});
vi.mock("../lib/runtime", async () => ({
  layer: (await import("effect/Layer")).empty,
  runtime: {},
}));
vi.mock("../persistence/mobile-preferences", () => ({}));
vi.mock("./entities", () => ({ useProjects: () => [] }));

import { appAtomRegistry } from "./atom-registry";
import {
  activeSidebarProfileAtom,
  selectMobileSidebarProfile,
  useMobileProfileRoute,
} from "./sidebar-profiles";

function BackgroundThread({ focused = true }: { focused?: boolean }) {
  useMobileProfileRoute(
    {
      environmentId: EnvironmentId.make("host"),
      projectId: ProjectId.make("project"),
    },
    { key: "thread", focused },
  );
  return null;
}
async function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<RegistryContext value={appAtomRegistry}>{ui}</RegistryContext>));
  return {
    async render(next: ReactNode) {
      await act(() =>
        root.render(<RegistryContext value={appAtomRegistry}>{next}</RegistryContext>),
      );
    },
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}
it("keeps an explicitly selected profile while a previous thread remains mounted in the background", async () => {
  let document = applySidebarProfileMutation(defaultSidebarProfiles(), {
    kind: "enable",
    enabled: true,
  });
  document = applySidebarProfileMutation(document, {
    kind: "create",
    profile: { id: "work", name: "Work", icon: "◉", color: "blue" },
  });
  fixture.set(JSON.stringify(document));
  selectMobileSidebarProfile("general");
  await using screen = await mount(<BackgroundThread />);
  await act(() => selectMobileSidebarProfile("work"));
  expect(appAtomRegistry.get(activeSidebarProfileAtom)).toBe("work");
  await screen.render(<BackgroundThread focused={false} />);
  expect(appAtomRegistry.get(activeSidebarProfileAtom)).toBe("work");
  await screen.render(<BackgroundThread focused />);
  expect(appAtomRegistry.get(activeSidebarProfileAtom)).toBe("general");
});
