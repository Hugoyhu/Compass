import { cn } from "@/lib/utils";

/** Two-part meter: black for completed work, red for work in progress, on a gray track. */
export function ProgressMeter({
  completed,
  inProgress = 0,
  label,
  className,
}: {
  /** 0–1 */
  completed: number;
  /** 0–1 */
  inProgress?: number;
  label: string;
  className?: string;
}) {
  const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(completed * 100)}
      className={cn("flex h-2 w-full overflow-hidden bg-foreground/10", className)}
    >
      {completed > 0 && <div className="h-full bg-foreground" style={{ width: pct(completed) }} />}
      {inProgress > 0 && <div className="h-full bg-primary" style={{ width: pct(inProgress) }} />}
    </div>
  );
}
