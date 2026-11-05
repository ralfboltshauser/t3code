import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { sidebarFolderRowId } from "./SidebarProjectFolderHeader";

export function sidebarProjectWorkingRowId(projectKey: string) {
  return `project-working:${projectKey}`;
}

export function SidebarProjectWorkingHeader(props: {
  projectKey: string;
  projectName: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="list-none ps-6">
      <CollapsibleSectionHeader
        size="default"
        data-sidebar-row={sidebarProjectWorkingRowId(props.projectKey)}
        data-sidebar-parent={sidebarFolderRowId(props.projectKey)}
        aria-label={`Working in ${props.projectName}, ${props.count} ${props.count === 1 ? "thread" : "threads"}`}
        expanded={props.expanded}
        onClick={props.onToggle}
        accessory={<span className="font-normal tabular-nums">{props.count}</span>}
      >
        Working
      </CollapsibleSectionHeader>
    </li>
  );
}
