/**
 * Assembles the Semester Planner: the student's plan, checked term by term,
 * and what it completes. Also builds the context the plan actions need.
 */
import { getRepository } from "@/lib/data/repository";
import type { Section } from "@/lib/domain/catalog/offering";
import { nextRegularTerm, nextTerm } from "@/lib/domain/terms";
import type { CourseCode, StudentRecord, TermId } from "@/lib/domain/types";
import { checkPlan, type PlanContext } from "@/lib/engine/plan";

/** Main-campus sections per course (SUNY Korea sections don't count as offerings here). */
export function countMainCampusSections(sections: Section[]): Map<CourseCode, number> {
  const counts = new Map<CourseCode, number>();
  for (const s of sections) if (s.campus === "main") counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  return counts;
}

/** Terms a plan can start from: everything after the current term. */
function upcomingTerms(student: StudentRecord, count: number): TermId[] {
  const terms: TermId[] = [];
  let term = student.currentTerm;
  for (let i = 0; i < count; i++) terms.push((term = nextTerm(term)));
  return terms;
}

export async function planContext(student: StudentRecord): Promise<PlanContext> {
  const repo = getRepository();
  const [courses, programs, sbcCategories, creditRules] = await Promise.all([
    repo.listCourses(),
    repo.listPrograms(),
    repo.listSbcCategories(),
    repo.getUniversityCreditRules(),
  ]);
  // Schedule data exists for only a few terms; check the planned ones and the next regular term.
  const terms = new Set([...student.plan.map((t) => t.term), nextRegularTerm(student.currentTerm)]);
  const sectionsByTerm = new Map<TermId, Map<CourseCode, number>>();
  await Promise.all(
    [...terms].map(async (term) => {
      const sections = await repo.listSections(term);
      if (sections?.length) sectionsByTerm.set(term, countMainCampusSections(sections));
    }),
  );
  return { student, programs, courses, sbcCategories, creditRules, sectionsByTerm };
}

export async function getPlanView(student: StudentRecord) {
  const ctx = await planContext(student);
  const { terms, projection } = checkPlan(ctx, student.plan);
  const planned = new Set(student.plan.map((t) => t.term));
  return {
    terms,
    projection: { ...projection, countsByCourse: undefined },
    hasPrograms: student.programIds.length > 0,
    courses: ctx.courses.map((c) => ({ code: c.code, title: c.title })),
    // Terms that can be added: the next two years, not already in the plan.
    termOptions: upcomingTerms(student, 8).filter((t) => !planned.has(t)),
  };
}

export type PlanView = Awaited<ReturnType<typeof getPlanView>>;
