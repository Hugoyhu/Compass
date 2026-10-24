import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { AddToPlan } from "@/components/courses/add-to-plan";
import { CourseStatusBadge } from "@/components/courses/course-status";
import { PrereqTree } from "@/components/courses/prereq-tree";
import { SectionTable } from "@/components/courses/section-table";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { codeFromSlug, slugFor } from "@/lib/domain/course-slug";
import { formatTerm } from "@/lib/domain/terms";
import { getCourseDetail } from "@/lib/services/courses";
import { getStudentRecord } from "@/lib/student/store";

/** Thousands of courses render on first visit instead of at build time. */
export async function generateStaticParams() {
  return [{ code: "CSE-214" }];
}

export async function generateMetadata({ params }: PageProps<"/courses/[code]">): Promise<Metadata> {
  return { title: codeFromSlug((await params).code) };
}

export default function CoursePage({ params }: PageProps<"/courses/[code]">) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <Link href="/courses" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
        <ArrowLeft />
        All courses
      </Link>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Course params={params} />
      </Suspense>
    </main>
  );
}

async function Course({ params }: Pick<PageProps<"/courses/[code]">, "params">) {
  const code = codeFromSlug((await params).code);
  const detail = await getCourseDetail(code, await getStudentRecord());
  if (!detail) notFound();
  const { course } = detail;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-sm text-muted-foreground">{course.code}</p>
          <h2 className="text-2xl font-semibold tracking-tight">{course.title}</h2>
          <p className="text-sm text-muted-foreground">
            {[
              `${detail.credits} ${detail.credits === "1" ? "credit" : "credits"}`,
              course.sbc.length > 0 && course.sbc.map((t) => (t.partial ? `${t.category} (partial)` : t.category)).join(", "),
              course.sbcMinGrade && `${course.sbcMinGrade} or higher for SBC`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {detail.status && <CourseStatusBadge status={detail.status} />}
          {detail.hasRecord && detail.status !== "taken" && detail.status !== "in-progress" && (
            <AddToPlan code={course.code} terms={detail.planTerms} plannedTerm={detail.plannedTerm} />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {course.description && (
            <Card size="sm">
              <CardContent>
                <p className="text-sm leading-relaxed">{course.description}</p>
              </CardContent>
            </Card>
          )}

          {(course.prerequisiteText || course.corequisiteText || course.advisoryText) && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Prerequisites</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {course.prerequisites ? (
                  <PrereqTree prereq={course.prerequisites} courses={detail.prereqCourses} />
                ) : (
                  course.prerequisiteText && <p className="text-sm">{course.prerequisiteText}</p>
                )}
                {detail.unverifiable.length > 0 && (
                  <p className="text-xs text-muted-foreground">Check yourself: {detail.unverifiable.join("; ")}</p>
                )}
                {course.corequisiteText && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Take with: </span>
                    {course.corequisiteText}
                  </p>
                )}
                {course.advisoryText && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Recommended: </span>
                    {course.advisoryText}
                  </p>
                )}
                {course.prerequisites && course.prerequisiteText && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Catalog text</summary>
                    <p className="mt-1.5 rounded-md bg-muted/50 p-2 leading-relaxed text-muted-foreground">{course.prerequisiteText}</p>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not on any schedule we have.</p>
              ) : (
                detail.sections.map((t) => (
                  <section key={t.term} className="space-y-1.5" aria-label={formatTerm(t.term)}>
                    <h3 className="text-xs font-medium text-muted-foreground">{formatTerm(t.term)}</h3>
                    <SectionTable sections={t.sections} />
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          {detail.countsToward.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Counts toward</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {detail.countsToward.map((c) => (
                    <li key={`${c.program}-${c.requirement}`}>
                      {c.requirement}
                      <span className="block text-xs text-muted-foreground">{c.program}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {detail.equivalents.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Not for credit with</CardTitle>
              </CardHeader>
              <CardContent>
                <CourseLinks courses={detail.equivalents} />
              </CardContent>
            </Card>
          )}

          {detail.unlocks.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Leads to</CardTitle>
              </CardHeader>
              <CardContent>
                <CourseLinks courses={detail.unlocks} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function CourseLinks({ courses }: { courses: { code: string; title: string | null }[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {courses.map((c) => (
        <li key={c.code} className="flex items-baseline gap-2">
          <Link href={`/courses/${slugFor(c.code)}`} className="shrink-0 font-mono text-xs underline-offset-4 hover:underline">
            {c.code}
          </Link>
          <span className="min-w-0 truncate text-muted-foreground">{c.title}</span>
        </li>
      ))}
    </ul>
  );
}
