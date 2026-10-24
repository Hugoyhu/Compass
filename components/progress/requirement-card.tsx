import { ShieldQuestion, TriangleAlert } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { StatusBadge } from "@/components/audit/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTerm } from "@/lib/domain/terms";
import type { CourseAttempt } from "@/lib/domain/types";
import type { RequirementResult } from "@/lib/engine/audit";
import { describeMissing, progressFractions } from "@/lib/engine/describe";
import type { CourseLabel } from "@/lib/services/dashboard";

const SOURCE_BADGE = { sbu: null, ap: "AP", transfer: "Transfer" } as const;

export function RequirementCard({
  result,
  labels,
  attempts,
}: {
  result: RequirementResult;
  labels: Record<string, CourseLabel>;
  attempts: Map<string, CourseAttempt>;
}) {
  const { completed, inProgress } = progressFractions(result);
  const open = result.status !== "satisfied";

  return (
    <Card id={result.requirement.id} size="sm" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-sm">
          <span className="mr-1.5 text-muted-foreground tabular-nums">{result.requirement.label}.</span>
          {result.requirement.title}
        </CardTitle>
        <CardAction>
          <StatusBadge status={result.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <ProgressMeter completed={completed} inProgress={inProgress} label={`${result.requirement.title} progress`} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {result.completed}
            {result.inProgress > 0 && ` + ${result.inProgress}`} / {result.required}
            {result.unit === "credits" ? " cr" : result.required === 1 ? " course" : " courses"}
          </span>
        </div>

        {result.applied.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {result.applied.map((a) => {
              const attempt = attempts.get(a.code);
              const source = SOURCE_BADGE[a.source];
              return (
                <li key={a.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                  <span className="w-16 shrink-0 font-mono text-xs">{a.code}</span>
                  <span className="min-w-0 flex-1 truncate">{labels[a.code]?.title ?? a.code}</span>
                  {source && (
                    <Badge variant="outline" className="font-normal">
                      {source}
                    </Badge>
                  )}
                  {a.viaSubstitution && (
                    <Badge variant="outline" className="font-normal">
                      Substitution
                    </Badge>
                  )}
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {a.state === "in-progress" ? "In progress" : attempt?.term ? formatTerm(attempt.term) : ""}
                  </span>
                  <span className="w-8 shrink-0 text-right text-xs font-medium">{a.state === "completed" ? a.grade : ""}</span>
                </li>
              );
            })}
          </ul>
        )}

        {open && result.missing.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Still needed</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {result.missing.map((item, i) => (
                <li key={i}>{describeMissing(item)}</li>
              ))}
            </ul>
          </div>
        )}

        {result.issues.map((issue) => (
          <p key={issue} className="flex items-start gap-1.5 text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-status-critical" aria-hidden />
            <span>
              <span className="sr-only">Problem: </span>
              {issue}
            </span>
          </p>
        ))}
        {result.manualChecks.map((check) => (
          <p key={check} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldQuestion className="mt-px size-3.5 shrink-0" aria-hidden />
            Advisor check: {check}
          </p>
        ))}

        <details className="group text-xs">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Catalog text</summary>
          <p className="mt-1.5 rounded-md bg-muted/50 p-2 leading-relaxed text-muted-foreground">{result.requirement.sourceText}</p>
        </details>
      </CardContent>
    </Card>
  );
}
