import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CreditSummary } from "@/lib/engine/audit";

const SEGMENTS = [
  { key: "sbu", label: "Stony Brook", color: "bg-series-1" },
  { key: "transfer", label: "Transfer", color: "bg-series-2" },
  { key: "ap", label: "AP", color: "bg-series-3" },
  { key: "inProgress", label: "In progress", color: "bg-series-4" },
] as const;

export function DegreeProgressCard({ credits }: { credits: CreditSummary }) {
  const values = { ...credits.bySource, inProgress: credits.inProgress };
  const remaining = Math.max(0, credits.required - credits.earned - credits.inProgress);
  const percent = Math.round((credits.earned / credits.required) * 100);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription>Degree progress</CardDescription>
        <CardTitle className="flex items-baseline gap-3">
          <span className="text-5xl font-semibold tracking-tight">{percent}%</span>
          <span className="text-sm font-normal text-muted-foreground">
            {credits.earned} / {credits.required} credits
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex h-3 w-full gap-0.5 overflow-hidden rounded"
          role="img"
          aria-label={`Credits by source: ${SEGMENTS.map((s) => `${s.label} ${values[s.key]}`).join(", ")}, ${remaining} remaining`}
        >
          {SEGMENTS.filter((s) => values[s.key] > 0).map((s) => (
            <Tooltip key={s.key}>
              <TooltipTrigger
                render={
                  <div
                    className={`${s.color} h-full basis-0 transition-opacity hover:opacity-85`}
                    style={{ flexGrow: values[s.key] }}
                  />
                }
              />
              <TooltipContent>
                {s.label}: {values[s.key]} credits
              </TooltipContent>
            </Tooltip>
          ))}
          {remaining > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <div
                    className="h-full basis-0 bg-muted"
                    style={{ flexGrow: remaining }}
                  />
                }
              />
              <TooltipContent>Remaining: {remaining} credits</TooltipContent>
            </Tooltip>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="space-y-0.5">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${s.color}`} aria-hidden />
                {s.label}
              </dt>
              <dd className="text-sm font-medium tabular-nums">{values[s.key]} cr</dd>
            </div>
          ))}
          <div className="space-y-0.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-muted ring-1 ring-border" aria-hidden />
              Remaining
            </dt>
            <dd className="text-sm font-medium tabular-nums">{remaining} cr</dd>
          </div>
        </dl>

        {credits.inProgress > 0 && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            With current courses:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {credits.earned + credits.inProgress} credits (
              {Math.round(((credits.earned + credits.inProgress) / credits.required) * 100)}%)
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
