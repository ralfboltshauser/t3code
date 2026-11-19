import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";

import { resolveThreadOpenRoute } from "../../lib/sideChatPane";
import { environmentThreadShells } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderSummary, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SidebarProjectStatus,
  SidebarProjectStatusBreakdown,
  sidebarProjectStatusLabel,
} from "./SidebarProjectStatus";

export function SidebarSideChatsStatus({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const sideChats = useAtomValue(environmentThreadShells.sideChatsAtom(threadRef));
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const children = sideChats
    .filter((thread) => thread.archivedAt === null)
    .map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        visits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    }));
  const summary = resolveSidebarFolderSummary(children);
  if (summary.total === 0) return null;
  const label = `${gt("Side chats")}: ${sidebarProjectStatusLabel(summary, messages)}`;
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            />
          }
        >
          <SidebarProjectStatus summary={summary} />
        </TooltipTrigger>
        <TooltipPopup side="right">
          <SidebarProjectStatusBreakdown summary={summary} heading={gt("Side chats")} />
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="right" align="start" onClick={(event) => event.stopPropagation()}>
        <div className="px-2 py-1 text-xs">
          <SidebarProjectStatusBreakdown summary={summary} heading={gt("Side chats")} />
        </div>
        <MenuSeparator />
        {children.map((thread) => (
          <MenuItem
            key={thread.id}
            onClick={() => {
              const route = resolveThreadOpenRoute(
                scopeThreadRef(thread.environmentId, thread.id),
                thread,
              );
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(route),
              });
            }}
          >
            <span className="max-w-64 truncate">{thread.title}</span>
            <MenuItemDetail>
              {sidebarProjectStatusLabel(resolveSidebarFolderSummary([thread]), messages)}
            </MenuItemDetail>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
