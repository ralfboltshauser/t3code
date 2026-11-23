import { msg, useGT, useMessages } from "gt-react";
import { CheckIcon, ChevronDownIcon, CircleDotIcon, CircleIcon, ListTodoIcon } from "lucide-react";

import type { TaskListPlan } from "../../session-logic";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

const STEP_STATUS = {
  completed: { Icon: CheckIcon, label: msg("Completed"), color: "text-success" },
  running: { Icon: CircleDotIcon, label: msg("Running"), color: "text-primary" },
  pending: { Icon: CircleIcon, label: msg("Pending"), color: "text-muted-foreground" },
};

export function ThreadDetailsTasks({
  plan,
  historical,
}: {
  plan: TaskListPlan;
  historical: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const title = historical ? gt("Last checklist") : gt("Agent tasks");
  const done = plan.steps.filter((step) => step.status === "completed").length;
  const total = plan.steps.length;

  return (
    <ThreadDetailsSection
      headingId="thread-details-tasks-heading"
      title={title}
      showHeading={false}
    >
      <Collapsible defaultOpen>
        <CollapsibleTrigger render={<ThreadDetailsControl />}>
          <ListTodoIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
            {done}/{total}
          </span>
          <span className="sr-only">{gt("{done} of {total} completed", { done, total })}</span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 text-muted-foreground in-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel animate={false}>
          <ul data-thread-details-task-list className="max-h-48 overflow-y-auto px-2.5 text-xs">
            {plan.steps.map((step) => {
              const { Icon, label, color } = STEP_STATUS[step.status];
              return (
                <li key={step.id} className="flex items-start gap-2 py-1">
                  <Icon aria-hidden className={`mt-px size-3.5 shrink-0 ${color}`} />
                  <span className="min-w-0 wrap-anywhere">
                    <span className="sr-only">{m(label)} </span>
                    {step.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </CollapsiblePanel>
      </Collapsible>
    </ThreadDetailsSection>
  );
}
