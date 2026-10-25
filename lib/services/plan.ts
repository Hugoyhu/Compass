/**
 * Builds the context the plan checks need: the student, the catalog, and what each term offers.
 */
import { getRepository } from "@/lib/data/repository";
import type { Section } from "@/lib/domain/catalog/offering";
import { nextRegularTerm, parseTerm, termOrdinal } from "@/lib/domain/terms";
import { MAX_TARGET_TERMS, MIN_TARGET_TERMS } from "@/lib/student/record";
import type { CourseCode, Season, StudentRecord, TermId } from "@/lib/domain/types";
import { choicesIn } from "@/lib/engine/describe";
import { matchesSelector, poolRoom, runDegreeAudit } from "@/lib/engine/audit";
import { checkPlan, degreeTerms, MAX_TERM_CREDITS, minTermCredits, semestersUsed, targetTerms, withPlan, type PlanContext } from "@/lib/engine/plan";
import { usableAttempts } from "@/lib/engine/prerequisites";
import { buildRoadmap } from "@/lib/engine/roadmap";
import { formatProgramName } from "@/lib/domain/program-name";

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
    projection: { ...projection, countsByCourse: undefined, slotOptions: undefined },
    hasPrograms: student.programIds.length > 0,
    // Concentrations (and specializations, tracks) not yet declared; until then the plan follows the closest one.
    undeclared: ctx.programs
      .filter((p) => student.programIds.includes(p.id))
      .flatMap((p) =>
        p.requirements.flatMap((r) =>
          choicesIn(r.rule)
            .filter((c) => !student.choices?.[c.id])
            .map((c) => ({ program: formatProgramName(p.name), kind: c.kind, href: `/progress?program=${p.id}#${r.id}` })),
        ),
      ),
    target: targetView(student, buildRoadmap(ctx).terms.perTerm),
    minCredits: minTermCredits(student),
    slotOptions: slotOptions(ctx),
    courses: ctx.courses.map((c) => ({ code: c.code, title: c.title })),
    sbcCategories: ctx.sbcCategories,
    // Terms that can be added: the next two years, not already in the plan.
    termOptions: upcomingTerms(student, 8).filter((t) => !planned.has(t)),
  };
}

export type PlanView = Awaited<ReturnType<typeof getPlanView>>;

/**
 * The semester target: how many, the last one, the choices (each with its last
 * semester), and planned semesters that run past it.
 */
function targetView(student: StudentRecord, perTerm: number) {
  const used = semestersUsed(student);
  const terms = degreeTerms(student);
  const last = terms.at(-1)!;
  const options: { terms: number; last: TermId }[] = [];
  let term = terms[0];
  for (let n = 1; n <= MAX_TARGET_TERMS; n++, term = nextRegularTerm(term)) {
    if (n >= Math.max(MIN_TARGET_TERMS, used + 1)) options.push({ terms: n, last: term });
  }
  return {
    terms: targetTerms(student),
    used,
    last,
    options,
    /** Credits a semester the rest of the degree takes to finish on time, and the most allowed without approval. */
    perTerm,
    maxCredits: MAX_TERM_CREDITS,
    beyond: student.plan.filter((t) => t.items.length > 0 && termOrdinal(t.term) > termOrdinal(last)).map((t) => t.term),
  };
}

/** Most courses offered for one elective slot. */
const MAX_SLOT_OPTIONS = 150;

/**
 * For each requirement the plan has elective slots for, the courses that can
 * fill one: in the requirement's open pool, under 500-level, and neither taken
 * or planned nor equivalent to a course that is.
 */
function slotOptions(ctx: PlanContext): Record<string, { code: CourseCode; title: string }[]> {
  const { student } = ctx;
  const ids = new Set(student.plan.flatMap((t) => t.items.flatMap((i) => ("slot" in i ? [i.slot] : []))));
  if (ids.size === 0) return {};
  const onHand = new Set(usableAttempts(withPlan(student, student.plan).attempts).map((a) => a.code));
  // A course equivalent to one taken or planned (CSE 303 for CSE 350) can't count again; equivalence may be recorded on either.
  for (const c of ctx.courses) {
    if (onHand.has(c.code)) c.equivalents.forEach((e) => onHand.add(e));
    else if (c.equivalents.some((e) => onHand.has(e))) onHand.add(c.code);
  }
  const audit = runDegreeAudit({ ...ctx, student: withPlan(student, student.plan) });
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const options: Record<string, { code: CourseCode; title: string }[]> = {};
  for (const r of audit.programs.flatMap((p) => p.requirements)) {
    if (!ids.has(r.requirement.id)) continue;
    const pools = r.missing.flatMap((m) => (m.kind === "choose" ? [m] : []));
    options[r.requirement.id] = ctx.courses
      .filter(
        (c) =>
          Number(c.code.split(" ")[1]) < 500 &&
          !onHand.has(c.code) &&
          pools.some((m) => !m.exclude.includes(c.code) && matchesSelector(c.code, c, m.pool) && poolRoom(m, r.applied, catalog, c.code) > 0),
      )
      .slice(0, MAX_SLOT_OPTIONS)
      .map((c) => ({ code: c.code, title: c.title }));
  }
  return options;
}

/** Everything left to graduate, reduced to the minimum, before it's put in semesters. */
export async function getRoadmap(student: StudentRecord) {
  return buildRoadmap(await planContext(student));
}
