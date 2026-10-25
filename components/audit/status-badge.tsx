import { CircleCheck, CircleDashed, Circle, CircleMinus, CircleHelp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequirementStatus } from "@/lib/engine/audit";
import { STATUS_LABELS } from "@/lib/engine/describe";

type DisplayStatus = RequirementStatus | "exempt" | "not-required";

const STYLES: Record<DisplayStatus, { icon: typeof Circle; className: string }> = {
  satisfied: { icon: CircleCheck, className: "text-status-good" },
  "in-progress": { icon: Clock, className: "text-[#a86f00]" },
  partial: { icon: CircleDashed, className: "text-muted-foreground" },
  "not-started": { icon: Circle, className: "text-muted-foreground" },
  "needs-review": { icon: CircleHelp, className: "text-[#a86f00]" },
  exempt: { icon: CircleMinus, className: "text-muted-foreground" },
  "not-required": { icon: CircleMinus, className: "text-muted-foreground" },
};

/** Status is always icon + label — never color alone. */
export function StatusBadge({
  status,
  className,
  compact = false,
}: {
  status: DisplayStatus;
  className?: string;
  compact?: boolean;
}) {
  const { icon: Icon, className: tone } = STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", className)}>
      <Icon className={cn("size-4 shrink-0", tone)} strokeWidth={2.75} aria-hidden />
      <span className={compact ? "sr-only" : "text-foreground/80"}>{STATUS_LABELS[status]}</span>
    </span>
  );
}

export function StatusIcon({ status, className }: { status: DisplayStatus; className?: string }) {
  const { icon: Icon, className: tone } = STYLES[status];
  return <Icon className={cn("size-4 shrink-0", tone, className)} strokeWidth={2.75} aria-label={STATUS_LABELS[status]} />;
}
