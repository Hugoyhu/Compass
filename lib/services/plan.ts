/**
 * Builds the context the plan checks need: the student, the catalog, and what each term offers.
 */
import { getRepository } from "@/lib/data/repository";
import type { Section } from "@/lib/domain/catalog/offering";
import { nextRegularTerm, parseTerm } from "@/lib/domain/terms";
import type { CourseCode, Season, StudentRecord, TermId } from "@/lib/domain/types";
import { choicesIn } from "@/lib/engine/describe";
import { checkPlan, minTermCredits, type PlanContext } from "@/lib/engine/plan";

/** A season's schedule counts as complete when it lists at least this share of the fullest term's courses. */
const COMPLETE_SCHEDULE_SHARE = 0.5;

function upcomingTerms(student: StudentRecord, count: number): TermId[] {
  const terms: TermId[] = [];
  let term = nextRegularTerm(student.currentTerm);
  for (let i = 0; i < count; i++) {
    terms.push(term);
    term = nextRegularTerm(term);
  }
  return terms;
}

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
export async function getPlanView(student: StudentRecord) {
  const ctx = await planContext(student);
  const { terms, projection } = checkPlan(ctx, student.plan);
  const planned = new Set(student.plan.map((t) => t.term));
  return {
    terms,
    projection: { ...projection, countsByCourse: undefined },
    hasPrograms: student.programIds.length > 0,
    // Concentrations (and specializations, tracks) not yet declared; until then the plan follows the closest one.
    undeclared: ctx.programs
      .filter((p) => student.programIds.includes(p.id))
      .flatMap((p) =>
        p.requirements.flatMap((r) =>
          choicesIn(r.rule)
            .filter((c) => !student.choices?.[c.id])
            .map((c) => ({ program: p.name, kind: c.kind, href: `/progress?program=${p.id}#${r.id}` })),
        ),
      ),
    minCredits: minTermCredits(student),
    courses: ctx.courses.map((c) => ({ code: c.code, title: c.title })),
    sbcCategories: ctx.sbcCategories,
    // Terms that can be added: the next two years, not already in the plan.
    termOptions: upcomingTerms(student, 8).filter((t) => !planned.has(t)),
  };
}

export type PlanView = Awaited<ReturnType<typeof getPlanView>>;
