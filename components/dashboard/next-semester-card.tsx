import Link from "next/link";
import { ArrowRight, Info, RotateCcw, ShieldQuestion, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTerm } from "@/lib/domain/terms";
import { plannedCredits } from "@/lib/engine/prerequisites";
import type { CheckedTerm } from "@/lib/engine/plan";
import type { SemesterProposal } from "@/lib/engine/planner";

export function NextSemesterCard({ proposal, planned }: { proposal: SemesterProposal; planned?: CheckedTerm }) {
  if (planned) return <PlannedTermCard term={planned} />;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription>Next semester</CardDescription>
        <CardTitle className="text-lg">{formatTerm(proposal.term)}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {proposal.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to suggest yet.</p>
        ) : (
          <ul className="space-y-3">
            {proposal.courses.map(({ course, fills, checks, retake, sections }) => (
              <li key={course.code} className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{course.code}</span>{" "}
                    <span className="sr-only">—</span>
                    {course.title}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {retake && (
                      <Badge variant="outline" className="gap-1 font-normal">
                        <RotateCcw />
                        Retake
                      </Badge>
                    )}
                    {fills.map((f) => (
                      <Badge key={f.requirementId} variant="secondary" className="font-normal">
                        {f.kind === "sbc" ? f.title.replace("SBC ", "") : f.title}
                      </Badge>
                    ))}
                  </div>
                  {!sections && <p className="text-xs text-muted-foreground">Not on the schedule yet</p>}
                  {checks.map((check) => (
                    <p key={check} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
                      Requires {check}
                    </p>
                  ))}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{plannedCredits(course)} cr</span>
              </li>
            ))}
          </ul>
        )}

        {proposal.deferred.length > 0 && (
          <div className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Still open:{" "}
              {proposal.deferred.map((d) => `${d.title} (${d.reason.toLowerCase()})`).join("; ")}.
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t bg-muted/30 py-3">
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{proposal.totalCredits}</span>{" "}
          <span className="text-muted-foreground">credits</span>
        </span>
        <Link href="/planner" className={buttonVariants({ size: "sm" })}>
          Planner
          <ArrowRight />
        </Link>
      </CardFooter>
    </Card>
  );
}

/** The first term of the student's own plan. */
function PlannedTermCard({ term }: { term: CheckedTerm }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription>Next semester · your plan</CardDescription>
        <CardTitle className="text-lg">{formatTerm(term.term)}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {term.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses planned.</p>
        ) : (
          <ul className="space-y-3">
            {term.items.map((item, i) => (
              <li key={`${item.code ?? "elective"}-${i}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className={item.code ? "font-medium" : "text-muted-foreground italic"}>
                    {item.code && <span className="font-mono text-xs text-muted-foreground">{item.code} </span>}
                    {item.title}
                  </p>
                  {item.counts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.counts.map((c) => (
                        <Badge key={c} variant="secondary" className="font-normal">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {item.problems.map((p) => (
                    <p key={p} className="flex items-start gap-1 text-xs text-status-critical">
                      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                      {p}
                    </p>
                  ))}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{item.credits} cr</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t bg-muted/30 py-3">
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{term.credits}</span> <span className="text-muted-foreground">credits</span>
        </span>
        <Link href="/planner" className={buttonVariants({ size: "sm" })}>
          Planner
          <ArrowRight />
        </Link>
      </CardFooter>
    </Card>
  );
}
