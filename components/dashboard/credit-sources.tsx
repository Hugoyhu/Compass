import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CreditSummary } from "@/lib/engine/audit";

const SEGMENTS = [
  { key: "sbu", label: "Stony Brook", color: "bg-series-1" },
  { key: "transfer", label: "Transfer", color: "bg-series-2" },
  { key: "ap", label: "AP", color: "bg-series-3" },
  { key: "inProgress", label: "In progress", color: "bg-series-4" },
] as const;

/** Where the student's credits come from, as one bar against the degree total. */
export function CreditSources({ credits }: { credits: CreditSummary }) {
  const values = { ...credits.bySource, inProgress: credits.inProgress };
  const remaining = Math.max(0, credits.required - credits.earned - credits.inProgress);

  return (
    <section aria-label="Credits by source" className="space-y-3">
      <div
        className="flex h-3 w-full"
        role="img"
        aria-label={`Credits by source: ${SEGMENTS.map((s) => `${s.label} ${values[s.key]}`).join(", ")}, ${remaining} remaining`}
      >
        {SEGMENTS.filter((s) => values[s.key] > 0).map((s) => (
          <Tooltip key={s.key}>
            <TooltipTrigger render={<div className={`${s.color} h-full basis-0`} style={{ flexGrow: values[s.key] }} />} />
            <TooltipContent>
              {s.label}: {values[s.key]} credits
            </TooltipContent>
          </Tooltip>
        ))}
        {remaining > 0 && <div className="h-full basis-0 bg-foreground/10" style={{ flexGrow: remaining }} />}
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`size-2.5 ${s.color}`} aria-hidden />
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd className="font-medium tabular-nums">{values[s.key]}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="size-2.5 bg-foreground/10" aria-hidden />
          <dt className="text-muted-foreground">Remaining</dt>
          <dd className="font-medium tabular-nums">{remaining}</dd>
        </div>
      </dl>
    </section>
  );
}
