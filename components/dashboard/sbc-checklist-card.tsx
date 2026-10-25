import { StatusIcon } from "@/components/audit/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { groupSbcResults, type SbcAudit, type SbcResult } from "@/lib/engine/audit";
import { STATUS_LABELS } from "@/lib/engine/describe";
import { cn } from "@/lib/utils";

export function SbcChecklistCard({ audit }: { audit: SbcAudit }) {
  const { required, threeOf } = groupSbcResults(audit.results);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Stony Brook Curriculum</CardTitle>
        <CardDescription>
          {audit.satisfied} of {audit.total} done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SbcGrid results={required} />
        {threeOf.length > 0 && (
          <>
            <p className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">Three of:</p>
            <SbcGrid results={threeOf} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SbcGrid({ results }: { results: SbcResult[] }) {
  return (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {results.map((r) => (
            <li key={r.category.code}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      className={cn(
                        "flex items-center gap-1.5 border border-foreground/30 px-2 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "data-[status=satisfied]:border-status-good/60 data-[status=satisfied]:bg-status-good/10 data-[status=satisfied]:[&_svg]:text-status-good",
                        "data-[status=in-progress]:border-status-progress/60 data-[status=in-progress]:bg-status-progress/10 data-[status=in-progress]:text-status-progress-strong",
                        "data-[status=exempt]:border-muted-foreground/20 data-[status=exempt]:bg-muted data-[status=exempt]:text-muted-foreground",
                        "data-[status=not-required]:border-muted-foreground/20 data-[status=not-required]:bg-muted data-[status=not-required]:text-muted-foreground",
                      )}
                      data-status={r.status}
                    >
                      <StatusIcon status={r.status} className="size-3.5" />
                      {r.category.code}
                    </div>
                  }
                />
                <TooltipContent className="max-w-xs">
                  <p className="font-medium">{r.category.name}</p>
                  <p className="opacity-80">
                    {STATUS_LABELS[r.status]}
                    {r.appliedCode ? ` via ${r.appliedCode}` : ""}
                    {r.exemptReason ? `: ${r.exemptReason}` : ""}
                  </p>
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
  );
}
