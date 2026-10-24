import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDays, formatRange } from "@/lib/domain/meeting-format";
import { formatTerm } from "@/lib/domain/terms";
import type { NextSemesterSchedule } from "@/lib/services/schedule";

/** The class sections the student picked in the Schedule Builder for next semester. */
export function NextSemesterCard({ schedule }: { schedule: NextSemesterSchedule }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription>Next semester</CardDescription>
        <CardTitle className="text-lg">{formatTerm(schedule.term)}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {!schedule.published ? (
          <p className="text-sm text-muted-foreground">The class schedule isn&apos;t published yet.</p>
        ) : schedule.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sections picked yet.</p>
        ) : (
          <ul className="space-y-3">
            {schedule.courses.map((course) => (
              <li key={course.code} className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{course.code}</span>{" "}
                    <span className="sr-only">—</span>
                    {course.title}
                  </p>
                  {course.sections.map((s) => (
                    <p key={s.id} className="text-xs text-muted-foreground">
                      {s.label} · {s.days.length ? `${formatDays(s.days)} ${formatRange(s)}` : "TBA"}
                      {s.room && s.room !== "TBA" && ` · ${s.room}`}
                      {s.instructors.length > 0 && ` · ${s.instructors.join(", ")}`}
                    </p>
                  ))}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{course.credits} cr</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t bg-muted/30 py-3">
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{schedule.credits}</span> <span className="text-muted-foreground">credits</span>
        </span>
        <Link href={`/planner?term=${schedule.term}`} className={buttonVariants({ size: "sm" })}>
          Schedule Builder
          <ArrowRight />
        </Link>
      </CardFooter>
    </Card>
  );
}
