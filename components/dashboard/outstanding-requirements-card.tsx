import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { StatusBadge } from "@/components/audit/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RequirementResult } from "@/lib/engine/audit";
import { describeRemaining, progressFractions } from "@/lib/engine/describe";

export function OutstandingRequirementsCard({
  results,
  programName,
}: {
  results: RequirementResult[];
  programName: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Outstanding requirements</CardTitle>
        <CardDescription>
          {results.length === 0
            ? `Every ${programName} requirement is satisfied`
            : `${results.length} ${programName} ${results.length === 1 ? "requirement needs" : "requirements need"} attention`}
        </CardDescription>
        <CardAction>
          <Link href="/progress" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Full audit
            <ArrowRight />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {results.map((result) => {
            const { completed, inProgress } = progressFractions(result);
            return (
              <li key={result.requirement.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">{result.requirement.label}.</span>
                    {result.requirement.title}
                  </p>
                  <StatusBadge status={result.status} className="pt-0.5" />
                </div>
                <div className="flex items-center gap-3">
                  <ProgressMeter
                    completed={completed}
                    inProgress={inProgress}
                    label={`${result.requirement.title} progress`}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {result.completed}
                    {result.inProgress > 0 && ` + ${result.inProgress}`} / {result.required}
                    {result.unit === "credits" ? " cr" : ""}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{describeRemaining(result)}</p>
                {result.issues.map((issue) => (
                  <p key={issue} className="flex items-start gap-1.5 text-xs text-foreground">
                    <TriangleAlert className="mt-px size-3.5 shrink-0 text-status-critical" aria-hidden />
                    <span>
                      <span className="sr-only">Problem: </span>
                      {issue}
                    </span>
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
