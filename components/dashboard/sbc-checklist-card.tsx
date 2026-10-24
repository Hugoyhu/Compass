import { StatusIcon } from "@/components/audit/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SbcAudit } from "@/lib/engine/audit";
import { STATUS_LABELS } from "@/lib/engine/describe";

export function SbcChecklistCard({ audit }: { audit: SbcAudit }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Stony Brook Curriculum</CardTitle>
        <CardDescription>
          {audit.satisfied} of {audit.total} done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {audit.results.map((r) => (
            <li key={r.category.code}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-[status=satisfied]:bg-muted/40"
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
      </CardContent>
    </Card>
  );
}
