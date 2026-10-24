import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { StatusBadge } from "@/components/audit/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RequirementResult } from "@/lib/engine/audit";
import { describeRemaining, itemNumber, progressFractions } from "@/lib/engine/describe";

export interface OutstandingGroup {
  programId: string;
  name: string;
  results: RequirementResult[];
}

export function OutstandingRequirementsCard({ groups }: { groups: OutstandingGroup[] }) {
  const left = groups.reduce((n, g) => n + g.results.length, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Remaining requirements</CardTitle>
        <CardDescription>{left === 0 ? "All done" : `${left} left`}</CardDescription>
        <CardAction>
          <Link href="/progress" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Details
            <ArrowRight />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups
          .filter((g) => g.results.length > 0)
          .map((group) => (
            <section key={group.programId} aria-label={group.name} className="space-y-1">
              {groups.length > 1 && (
                <Link href={`/progress?program=${group.programId}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  {group.name}
                </Link>
              )}
              <ul className="divide-y">
                {group.results.map((result) => (
                  <Outstanding key={result.requirement.id} result={result} />
                ))}
              </ul>
            </section>
          ))}
      </CardContent>
    </Card>
  );
}

function Outstanding({ result }: { result: RequirementResult }) {
  const { completed, inProgress } = progressFractions(result);
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium">
          {itemNumber(result.requirement.label) && <span className="mr-1.5 text-muted-foreground tabular-nums">{itemNumber(result.requirement.label)}.</span>}
          {result.requirement.title}
        </p>
        <StatusBadge status={result.status} className="pt-0.5" />
      </div>
      <div className="flex items-center gap-3">
        <ProgressMeter completed={completed} inProgress={inProgress} label={`${result.requirement.title} progress`} />
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
}
