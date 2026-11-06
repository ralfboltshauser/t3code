import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { sidebarFolderRowId } from "./SidebarProjectFolderHeader";

export function sidebarProjectWorkingRowId(
  projectKey: string,
  section: "Working" | "Read" = "Working",
) {
  return `project-${section.toLowerCase()}:${projectKey}`;
}

export function SidebarProjectWorkingHeader(props: {
  section?: "Working" | "Read";
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
        data-sidebar-row={sidebarProjectWorkingRowId(props.projectKey, props.section)}
        data-sidebar-parent={sidebarFolderRowId(props.projectKey)}
        aria-label={`${props.section ?? "Working"} in ${props.projectName}, ${props.count} ${props.count === 1 ? "thread" : "threads"}`}
        expanded={props.expanded}
        onClick={props.onToggle}
        accessory={<span className="font-normal tabular-nums">{props.count}</span>}
      >
        {props.section ?? "Working"}
      </CollapsibleSectionHeader>
    </li>
  );
}
