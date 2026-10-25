"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PrereqTree } from "@/components/courses/prereq-tree";
import type { getScheduleCourseDetail } from "@/app/actions/schedule";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDays, formatRange } from "@/lib/domain/meeting-format";
import { slugFor } from "@/lib/domain/course-slug";
import type {
  InstructorRating,
  ScheduleCourse,
  ScheduleSection,
} from "@/lib/services/schedule";

export type CourseDetail = NonNullable<
  Awaited<ReturnType<typeof getScheduleCourseDetail>>
>;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** A course from the schedule, expanded: the sections picked, their professors' ratings, and the catalog entry. */
export function CourseDialog({
  course,
  picked,
  ratings,
  detail,
  onClose,
}: {
  course: ScheduleCourse;
  /** Sections of this course on the schedule. */
  picked: ScheduleSection[];
  ratings: Record<string, InstructorRating>;
  /** Null while loading, or when the catalog has no entry for the course. */
  detail: CourseDetail | null | undefined;
  onClose: () => void;
}) {
  const instructors = [...new Set(picked.flatMap((s) => s.instructors))];
  const catalog = detail?.course;
  // A course opened from in here (a prerequisite, the full page) shows over the page as its own
  // modal; this one steps aside and returns when that modal closes.
  const open = usePathname() === "/planner";
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto p-6 sm:max-w-2xl">
        <div className="space-y-1">
          <p className="font-mono text-sm text-muted-foreground">
            {course.code}
          </p>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {course.title || course.code}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {[
              `${course.credits} ${course.credits === 1 ? "credit" : "credits"}`,
              catalog?.sbc.length &&
                catalog.sbc
                  .map((t) =>
                    t.partial ? `${t.category} (partial)` : t.category,
                  )
                  .join(", "),
              catalog?.sbcMinGrade &&
                `${catalog.sbcMinGrade} or higher for SBC`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <Section title="Your sections">
          <ul className="space-y-1.5 text-sm">
            {picked.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {s.days.length
                    ? `${formatDays(s.days)} ${formatRange(s)}`
                    : "TBA"}
                  {s.room && s.room !== "TBA" && ` · ${s.room}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {instructors.length > 0 && (
          <Section
            title={instructors.length === 1 ? "Professor" : "Professors"}
          >
            <ul className="space-y-2">
              {instructors.map((name) => {
                const r = ratings[name];
                return (
                  <li
                    key={name}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{name}</span>
                    {r ? (
                      <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
                        <span className="text-sm font-semibold text-foreground">
                          ★ {r.rating.toFixed(1)}
                        </span>
                        <span>{r.numRatings} ratings</span>
                        <span>Difficulty {r.difficulty.toFixed(1)}/5</span>
                        {r.wouldTakeAgain !== null && (
                          <span>{r.wouldTakeAgain}% would take again</span>
                        )}
                        <a
                          href={`https://www.ratemyprofessors.com/professor/${r.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        >
                          Rate My Professors
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No rating found
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {detail === undefined ? (
          <Skeleton className="h-40" />
        ) : !catalog ? (
          <p className="text-sm text-muted-foreground">
            No catalog entry for this course.
          </p>
        ) : (
          <>
            {catalog.description && (
              <Section title="Description">
                <p className="text-sm leading-relaxed">{catalog.description}</p>
              </Section>
            )}
            {(catalog.prerequisiteText ||
              catalog.corequisiteText ||
              catalog.advisoryText) && (
              <Section title="Prerequisites">
                <div className="space-y-2">
                  {catalog.prerequisites ? (
                    <PrereqTree
                      prereq={catalog.prerequisites}
                      courses={detail.prereqCourses}
                    />
                  ) : (
                    catalog.prerequisiteText && (
                      <p className="text-sm">{catalog.prerequisiteText}</p>
                    )
                  )}

                  {catalog.corequisiteText && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Take with: </span>
                      {catalog.corequisiteText}
                    </p>
                  )}
                  {catalog.advisoryText && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">
                        Recommended:{" "}
                      </span>
                      {catalog.advisoryText}
                    </p>
                  )}
                </div>
              </Section>
            )}
            {catalog.equivalents.length > 0 && (
              <Section title="Not for credit with">
                <p className="text-sm">{catalog.equivalents.join(", ")}</p>
              </Section>
            )}
          </>
        )}

        <Link
          href={`/courses/${slugFor(course.code)}`}
          className="text-sm underline-offset-4 hover:underline"
        >
          Open full course page
        </Link>
      </DialogContent>
    </Dialog>
  );
}
