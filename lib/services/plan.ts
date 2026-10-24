/**
 * Builds the context the plan checks need: the student, the catalog, and what each term offers.
 */
import { getRepository } from "@/lib/data/repository";
import type { Section } from "@/lib/domain/catalog/offering";
import { nextRegularTerm, parseTerm } from "@/lib/domain/terms";
import type { CourseCode, Season, StudentRecord, TermId } from "@/lib/domain/types";
import type { PlanContext } from "@/lib/engine/plan";

/** A season's schedule counts as complete when it lists at least this share of the fullest term's courses. */
const COMPLETE_SCHEDULE_SHARE = 0.5;

/** Main-campus sections per course (SUNY Korea sections don't count as offerings here). */
export function countMainCampusSections(sections: Section[]): Map<CourseCode, number> {
  const counts = new Map<CourseCode, number>();
  for (const s of sections) if (s.campus === "main") counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  return counts;
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
  return { student, programs, courses, sbcCategories, creditRules, sectionsByTerm, offeredBySeason: await offeredBySeason() };
}

/**
 * Courses offered on main campus in each season, from the season's most recent
 * schedule. A scrape that covers well under the fullest term's courses (a
 * partial run) says nothing about what's missing, so that season stays unknown.
 */
async function offeredBySeason(): Promise<Partial<Record<Season, Set<CourseCode>>>> {
  const repo = getRepository();
  const terms = await repo.listOfferingTerms();
  const byTerm = await Promise.all(
    terms.map(async (term) => ({
      term,
      codes: new Set(((await repo.listSections(term)) ?? []).filter((s) => s.campus === "main").map((s) => s.code)),
    })),
  );
  const fullest = Math.max(0, ...byTerm.map((t) => t.codes.size));
  const offered: Partial<Record<Season, Set<CourseCode>>> = {};
  for (const { term, codes } of byTerm) {
    // Later terms replace earlier ones, since listOfferingTerms is oldest first.
    if (codes.size >= fullest * COMPLETE_SCHEDULE_SHARE) offered[parseTerm(term).season] = codes;
  }
  return offered;
}
