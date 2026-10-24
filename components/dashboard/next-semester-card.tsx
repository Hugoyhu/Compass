import Link from "next/link";
import { ArrowRight, Info, RotateCcw, ShieldQuestion, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTerm } from "@/lib/domain/terms";
import { plannedCredits } from "@/lib/engine/prerequisites";
import type { NeedKind, SemesterProposal } from "@/lib/engine/planner";

const KIND_LABEL: Record<NeedKind, string> = { required: "Required", sbc: "SBC", elective: "Elective" };

export function NextSemesterCard({ proposal }: { proposal: SemesterProposal }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Sparkles className="size-3.5" aria-hidden />
          Proposed next semester
        </CardDescription>
        <CardTitle className="text-lg">{formatTerm(proposal.term)}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {proposal.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No eligible courses found for this term.</p>
        ) : (
          <ul className="space-y-3">
            {proposal.courses.map(({ course, fills, checks, retake }) => (
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
                        {KIND_LABEL[f.kind]} · {f.kind === "sbc" ? f.title.replace("SBC ", "") : f.title}
                      </Badge>
                    ))}
                  </div>
                  {checks.map((check) => (
                    <p key={check} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
                      Check prerequisite: {check}
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
              Still open after this term:{" "}
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
          Open planner
          <ArrowRight />
        </Link>
      </CardFooter>
    </Card>
  );
}
