/**
 * Assembles what the dashboard and degree-progress pages render for one
 * student. Pages call this; components receive plain data and never run
 * audit or planning logic themselves.
 */
import { getRepository } from "@/lib/data/repository";
import type { CourseRecord } from "@/lib/domain/catalog/course";
import { nextRegularTerm } from "@/lib/domain/terms";
import type { StudentRecord } from "@/lib/domain/types";
import { runDegreeAudit } from "@/lib/engine/audit";
import { estimateGraduationTerm, proposeNextSemester } from "@/lib/engine/planner";

/** Display info for a course code, falling back to the transcript title for unknown courses. */
export interface CourseLabel {
  code: string;
  title: string;
  inCatalog: boolean;
}

export async function getStudentView(student: StudentRecord) {
  const repo = getRepository();
  const [source, courses, programs, sbcCategories, creditRules] = await Promise.all([
    repo.source(),
    repo.listCourses(),
    repo.listPrograms(),
    repo.listSbcCategories(),
    repo.getUniversityCreditRules(),
  ]);

  const audit = runDegreeAudit({ student, programs, courses, sbcCategories, creditRules });
  const nextTerm = nextRegularTerm(student.currentTerm);
  const proposal = proposeNextSemester({ audit, student, courses, term: nextTerm });
  const graduation = estimateGraduationTerm(audit, student.currentTerm);

  const catalog = new Map(courses.map((c) => [c.code, c]));
  const labels: Record<string, CourseLabel> = {};
  for (const attempt of student.attempts) {
    const course = catalog.get(attempt.code);
    labels[attempt.code] = { code: attempt.code, title: course?.title ?? attempt.title ?? "Course not in catalog data", inCatalog: !!course };
  }

  const currentCourses = student.attempts
    .filter((a) => a.status === "in-progress")
    .map((attempt) => ({
      attempt,
      title: labels[attempt.code].title,
      credits: attempt.credits ?? catalog.get(attempt.code)?.credits.max ?? 0,
    }));

  return {
    source,
    student,
    audit,
    major: audit.programs.find((p) => p.program.kind === "major"),
    proposal,
    graduation,
    currentCourses,
    labels,
  };
}

export type StudentView = Awaited<ReturnType<typeof getStudentView>>;

/** Options for the course editor: catalog courses and selectable programs. */
export async function getEditorOptions() {
  const repo = getRepository();
  const [courses, programs] = await Promise.all([repo.listCourses(), repo.listPrograms()]);
  return {
    courses: courses.map((c: CourseRecord) => ({ code: c.code, title: c.title, credits: c.credits.max })),
    programs: programs.map((p) => ({ id: p.id, name: p.name, kind: p.kind, reviewed: p.review.status === "reviewed" })),
  };
}
