import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, SquarePenIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderSummary, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  SidebarProjectStatus,
  SidebarProjectStatusBreakdown,
  sidebarProjectStatusLabel,
} from "./SidebarProjectStatus";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The folder's sidebar tree row; its thread rows name it as their parent. */
export function sidebarFolderRowId(projectKey: string) {
  return `folder:${projectKey}`;
}

export const SidebarProjectFolderHeader = memo(function SidebarProjectFolderHeader(props: {
  group: SidebarProjectSnapshot;
  collapsed: boolean;
  threads: readonly EnvironmentThreadShell[];
  onToggle: (group: SidebarProjectSnapshot) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
  onContextMenu: (group: SidebarProjectSnapshot, position: { x: number; y: number }) => void;
}) {
  const { group, collapsed, threads } = props;
  const rowId = sidebarFolderRowId(group.projectKey);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const summary = resolveSidebarFolderSummary(
    threads.map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    })),
  );
  return (
    <li
      data-testid="sidebar-project-folder"
      className="group/project-folder relative mt-2 list-none first:mt-0"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-row={rowId}
              aria-expanded={!collapsed}
              aria-label={`${group.displayName}, ${sidebarProjectStatusLabel(summary)}`}
              onClick={() => props.onToggle(group)}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(group, { x: event.clientX, y: event.clientY });
              }}
              className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ProjectFavicon project={group} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
                {group.displayName}
              </span>
              {summary.total > 0 ? <SidebarProjectStatus summary={summary} /> : null}
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-3 shrink-0 text-sidebar-muted-foreground transition-transform group-hover/project-folder:invisible group-focus-within/project-folder:invisible pointer-coarse:invisible",
                  collapsed && "-rotate-90",
                )}
              />
            </button>
          }
        />
        <TooltipPopup side="right">
          <SidebarProjectStatusBreakdown summary={summary} />
        </TooltipPopup>
      </Tooltip>

      <span className="absolute inset-y-0 right-0.5 flex items-center opacity-0 group-focus-within/project-folder:opacity-100 group-hover/project-folder:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                data-sidebar-action-for={rowId}
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`New thread in ${group.displayName}`}
                onClick={() => props.onNewThread(group)}
              />
            }
          >
            <SquarePenIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup>New thread in {group.displayName}</TooltipPopup>
        </Tooltip>
      </span>
    </li>
  );
});
