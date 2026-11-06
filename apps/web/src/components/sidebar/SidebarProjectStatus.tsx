import type { resolveSidebarFolderSummary } from "../Sidebar.logic";

const SEGMENTS = [
  { key: "attention", label: "Needs attention", color: "stroke-warning", dot: "bg-warning" },
  { key: "failed", label: "Failed", color: "stroke-error", dot: "bg-error" },
  { key: "unread", label: "Unread results", color: "stroke-success", dot: "bg-success" },
  { key: "working", label: "Working", color: "stroke-info", dot: "bg-info" },
  {
    key: "quiet",
    label: "Read or idle",
    color: "stroke-sidebar-muted-foreground/50",
    dot: "bg-sidebar-muted-foreground/50",
  },
] as const;

const RADIUS = 5.875;
const STROKE = 1.25;
const CAP_ANGLE = (Math.atan(STROKE / 2 / RADIUS) * 180) / Math.PI;

type Summary = ReturnType<typeof resolveSidebarFolderSummary>;

function point(angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return `${7 + RADIUS * Math.cos(radians)} ${7 + RADIUS * Math.sin(radians)}`;
}

export function sidebarProjectStatusLabel(summary: Summary) {
  if (summary.total === 0) return "0 chats";
  return `${summary.total} ${summary.total === 1 ? "chat" : "chats"}: ${SEGMENTS.filter(
    ({ key }) => summary[key] > 0,
  )
    .map(
      ({ key, label }) =>
        `${summary[key]} ${key === "unread" && summary[key] === 1 ? "unread result" : label.toLowerCase()}`,
    )
    .join(", ")}`;
}

export function SidebarProjectStatus({ summary }: { summary: Summary }) {
  const segments = SEGMENTS.filter(({ key }) => summary[key] > 0);
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none size-3.5 shrink-0"
        viewBox="0 0 14 14"
        fill="none"
      >
        {segments.map(({ key, color }, index) => {
          const start =
            (segments.slice(0, index).reduce((sum, segment) => sum + summary[segment.key], 0) /
              summary.total) *
            360;
          const angle = (summary[key] / summary.total) * 360;
          if (segments.length === 1) {
            return (
              <circle key={key} cx="7" cy="7" r={RADIUS} strokeWidth={STROKE} className={color} />
            );
          }
          // Tiny shares keep their true extent instead of overlapping their neighbors with round caps.
          const rounded = angle > CAP_ANGLE * 2 + 8;
          const inset = rounded ? CAP_ANGLE + 4 : 0;
          const end = start + angle - inset;
          return (
            <path
              key={key}
              d={`M ${point(start + inset)} A ${RADIUS} ${RADIUS} 0 ${angle - inset * 2 > 180 ? 1 : 0} 1 ${point(end)}`}
              strokeWidth={STROKE}
              strokeLinecap={rounded ? "round" : "butt"}
              className={color}
            />
          );
        })}
      </svg>
      <span aria-hidden className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
        {summary.total}
      </span>
    </>
  );
}

export function SidebarProjectStatusBreakdown({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-1 py-0.5">
      <span className="font-medium">
        {summary.total} {summary.total === 1 ? "chat" : "chats"}
      </span>
      {SEGMENTS.filter(({ key }) => summary[key] > 0).map(({ key, label, dot }) => (
        <span key={key} className="flex items-center gap-2">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          <span className="flex-1">{label}</span>
          <span className="tabular-nums">{summary[key]}</span>
        </span>
      ))}
    </div>
  );
}
