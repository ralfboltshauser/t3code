import { useGT } from "gt-react";
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
  const gt = useGT();
  return (
    <li className="list-none ps-6">
      <CollapsibleSectionHeader
        size="default"
        data-sidebar-row={sidebarProjectWorkingRowId(props.projectKey, props.section)}
        data-sidebar-parent={sidebarFolderRowId(props.projectKey)}
        aria-label={gt(
          "{section, select, Read {Read} other {Working}} in {project}, {count, plural, one {{count} thread} other {{count} threads}}",
          {
            section: props.section ?? "Working",
            project: props.projectName,
            count: props.count,
          },
        )}
        expanded={props.expanded}
        onClick={props.onToggle}
        accessory={<span className="font-normal tabular-nums">{props.count}</span>}
      >
        {props.section === "Read"
          ? gt("Read", { $context: "sidebar section" })
          : gt("Working", { $context: "sidebar section" })}
      </CollapsibleSectionHeader>
    </li>
  );
}
