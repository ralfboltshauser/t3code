import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  applySidebarProfileMutation,
  defaultSidebarProfiles,
} from "@t3tools/client-runtime/sidebar-profiles";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, act } from "../../test/render";
import { ProfileAwareLanding } from "../routes/_chat.index";
import { useSidebarProfiles } from "../sidebarProfiles";
import {
  __setClientSettingsForTests,
  getClientSettings,
  useClientSettingsHydrated,
} from "../hooks/useSettings";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { readProject, useProjects, useVisibleThreadShells } from "../state/entities";
import { newDraftId, newThreadId } from "../lib/utils";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useSettings", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });

describe("profile startup", () => {
  it.each([
    { profilesReady: false, settingsReady: true },
    { profilesReady: true, settingsReady: false },
  ])(
    "waits for saved profile and sidebar settings before starting a draft: $profilesReady/$settingsReady",
    async (scenario) => {
      using cleanup = new DisposableStack();
      const previous = useSidebarProfiles.getState();
      const settings = getClientSettings();
      cleanup.defer(() => {
        useSidebarProfiles.setState(previous);
        __setClientSettingsForTests(settings);
        vi.mocked(useProjects).mockRestore();
        vi.mocked(readProject).mockRestore();
        vi.mocked(useVisibleThreadShells).mockRestore();
        vi.mocked(useNewThreadHandler).mockRestore();
        vi.mocked(useClientSettingsHydrated).mockRestore();
      });
      const project = {
        environmentId: EnvironmentId.make("startup-host"),
        id: ProjectId.make("startup-project"),
        title: "Work project",
        workspaceRoot: "/work/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
      };
      vi.mocked(useProjects).mockReturnValue([project]);
      vi.mocked(readProject).mockReturnValue(project);
      vi.mocked(useVisibleThreadShells).mockReturnValue([]);
      const start = vi.fn().mockResolvedValue({ draftId: newDraftId(), threadId: newThreadId() });
      vi.mocked(useNewThreadHandler).mockReturnValue(start);
      vi.mocked(useClientSettingsHydrated).mockReturnValue(scenario.settingsReady);
      __setClientSettingsForTests({
        ...DEFAULT_CLIENT_SETTINGS,
        boringSidebarEnabled: scenario.settingsReady,
      });
      let document = applySidebarProfileMutation(defaultSidebarProfiles(), {
        kind: "enable",
        enabled: true,
      });
      document = applySidebarProfileMutation(document, {
        kind: "create",
        profile: { id: "work", name: "Work", icon: "💼", color: "blue" },
      });
      document = applySidebarProfileMutation(document, {
        kind: "assign-projects",
        projects: [{ environmentId: project.environmentId, projectId: project.id }],
        profileId: "work",
      });
      useSidebarProfiles.setState({
        document: scenario.profilesReady ? document : defaultSidebarProfiles(),
        ready: scenario.profilesReady,
        activeId: "work",
      });
      await using screen = await render(<ProfileAwareLanding />);
      expect(start).not.toHaveBeenCalled();
      await act(() => {
        __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
        vi.mocked(useClientSettingsHydrated).mockReturnValue(true);
        useSidebarProfiles.setState({ document, ready: true });
      });
      await screen.rerender(<ProfileAwareLanding />);
      await expect.element(screen.getByRole("heading", { name: "💼 Work" })).toBeVisible();
      expect(start).not.toHaveBeenCalled();
    },
  );
});
