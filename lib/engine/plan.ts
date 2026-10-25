/**
 * Multi-term plans: check one and project what it completes. The scheduler
 * (scheduler.ts) generates them.
 *
 * Planned courses are modeled as in-progress attempts in their term, so the
 * audit and prerequisite checks treat them as "will be passed". Free
 * electives have no course code and only add credits. SBC placeholders add
 * credits and count their SBC as planned. Elective slots add credits toward a
 * requirement's pool without naming the course.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import { nextRegularTerm, parseTerm, termOrdinal } from "@/lib/domain/terms";
import type {
  CourseAttempt,
  CourseCode,
  PlannedTerm,
  PlanItem,
  SbcCategory,
  SbcCode,
  Season,
  StudentRecord,
  TermId,
} from "@/lib/domain/types";
import {
  DEEPER_UNDERSTANDING,
  runDegreeAudit,
  summarizeCredits,
  type DegreeAudit,
  type MissingItem,
  type SbcResult,
} from "./audit";
import { isUpperDivisionPool, requirementHeading } from "./describe";
import { primarySubject } from "./planner";
import {
  buildCompletionIndex,
  evaluatePrereq,
  formatPrereq,
  pairedCorequisite,
  plannedCredits,
  standingFor,
  usableAttempts,
} from "./prerequisites";
import { formatProgramName } from "@/lib/domain/program-name";

/** Above this, Stony Brook requires approval for the term's load. */
export const MAX_TERM_CREDITS = 19;
/** Below this, a fall or spring term is part-time; the default minimum per term. */
export const FULL_TIME_CREDITS = 12;
/** Credits planned for an SBC placeholder; upper-tier SBCs need at least 3. */
export const SBC_PLACEHOLDER_CREDITS = 3;

const YEAR_WORDS: Record<string, number> = { first: 1, freshman: 1, second: 2, sophomore: 2, third: 3, junior: 3, fourth: 4, senior: 4 };

/**
 * The earliest academic year a requirement's title allows: "Second- and
 * third-year Honors courses" → 2, "Senior Project" → 4. Titles without year
 * words allow any year.
 */
export function earliestYear(title: string): number {
  if (!/year|freshman|sophomore|junior|senior/i.test(title)) return 1;
  const years = [...title.toLowerCase().matchAll(/\b(first|second|third|fourth|freshman|sophomore|junior|senior)\b/g)].map((m) => YEAR_WORDS[m[1]]);
  return years.length ? Math.min(...years) : 1;
}

export interface PlanContext {
  student: StudentRecord;
  programs: ProgramDefinition[];
  courses: CourseRecord[];
  sbcCategories: SbcCategory[];
  creditRules: Parameters<typeof summarizeCredits>[2];
  /** Main-campus sections per course for terms with schedule data; a missing term means unknown. */
  sectionsByTerm: Map<TermId, Map<CourseCode, number>>;
  /**
   * Courses known to run in each season, from that season's most recent
   * schedule; a season without a complete enough schedule is missing (unknown).
   */
  offeredBySeason: Partial<Record<Season, Set<CourseCode>>>;
}

/**
 * The student's record with planned courses added as in-progress. A planned
 * course the student already completed is a retake, so it replaces the
 * earlier attempt.
 */
export function withPlan(student: StudentRecord, plan: PlannedTerm[]): StudentRecord {
  const planned: CourseAttempt[] = plan.flatMap((t) =>
    t.items.flatMap((i) => ("code" in i ? [{ code: i.code, source: "sbu" as const, term: t.term, status: "in-progress" as const }] : [])),
  );
  const retaken = new Set(planned.map((a) => a.code));
  const kept = student.attempts.filter((a) => a.status === "in-progress" || !retaken.has(a.code));
  return { ...student, attempts: [...kept, ...planned] };
}

function audit(ctx: PlanContext, student: StudentRecord): DegreeAudit {
  return runDegreeAudit({ ...ctx, student });
}

/** Credits for an item without a course code: an elective, an SBC placeholder, or an elective slot. */
export function placeholderCredits(item: PlanItem): number {
  if ("elective" in item) return item.elective;
  if ("sbc" in item) return SBC_PLACEHOLDER_CREDITS;
  if ("slot" in item) return item.credits;
  return 0;
}

export function electiveCredits(plan: PlannedTerm[]): number {
  return plan.flatMap((t) => t.items).reduce((s, i) => s + placeholderCredits(i), 0);
}

function sbcPlaceholders(plan: PlannedTerm[]): Set<SbcCode> {
  return new Set(plan.flatMap((t) => t.items.flatMap((i) => ("sbc" in i ? [i.sbc] : []))));
}

const isDone = (status: string) => status === "satisfied" || status === "in-progress" || status === "exempt";
/** Only an advisor can settle these; no planned course will. */
const isReview = (status: string) => status === "needs-review";

/**
 * SBC objectives still open, counting planned courses and placeholders as done.
 * Only three of the four Pursue Deeper Understanding categories are required.
 */
function openSbc(a: DegreeAudit, placeholders: Set<SbcCode> = new Set()): SbcResult[] {
  const done = (r: SbcResult) => isDone(r.status) || placeholders.has(r.category.code);
  const isDeeper = (r: SbcResult) => DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeperDone = a.sbc.results.filter((r) => isDeeper(r) && done(r)).length;
  return a.sbc.results.filter((r) => !done(r) && !(isDeeper(r) && deeperDone >= DEEPER_UNDERSTANDING.required));
}

/** SBCs that still need a placeholder: every open one, but only enough Deeper Understanding ones for three. */
export function sbcToPlace(a: DegreeAudit): SbcCode[] {
  const open = openSbc(a);
  const isDeeper = (r: SbcResult) => DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeperDone = a.sbc.results.filter((r) => isDeeper(r) && isDone(r.status)).length;
  const deeper = open.filter(isDeeper).slice(0, Math.max(0, DEEPER_UNDERSTANDING.required - deeperDone));
  return open.filter((r) => !isDeeper(r) || deeper.includes(r)).map((r) => r.category.code);
}

/** The student's minimum credits for a fall or spring term. */
export function minTermCredits(student: StudentRecord): number {
  return student.minTermCredits ?? FULL_TIME_CREDITS;
}

/** A degree is planned as eight fall and spring semesters unless the student picks another number. */
export const DEGREE_TERMS = 8;

/** Fall and spring semesters the student aims to graduate in. */
export function targetTerms(student: StudentRecord): number {
  return student.targetTerms ?? DEGREE_TERMS;
}

/** The student's first fall or spring semester. */
function firstRegularTerm(student: StudentRecord): TermId {
  const entry = student.entryTerm;
  return entry.endsWith("FA") || entry.endsWith("SP") ? entry : nextRegularTerm(entry);
}

/** The fall/spring semesters of the degree, from the student's first one through the target. */
export function degreeTerms(student: StudentRecord): TermId[] {
  let term = firstRegularTerm(student);
  const terms: TermId[] = [];
  for (let i = 0; i < targetTerms(student); i++, term = nextRegularTerm(term)) terms.push(term);
  return terms;
}

/** Fall and spring semesters taken or in progress, from the first through the current one. */
export function semestersUsed(student: StudentRecord): number {
  let t = firstRegularTerm(student);
  let used = 0;
  for (; termOrdinal(t) <= termOrdinal(student.currentTerm); t = nextRegularTerm(t)) used++;
  return used;
}

/** A term's place among the student's fall and spring semesters: 0 for the first. */
export function semesterIndex(student: StudentRecord, term: TermId): number {
  let t = firstRegularTerm(student);
  let index = 0;
  for (; termOrdinal(t) < termOrdinal(term); t = nextRegularTerm(t)) index++;
  return index;
}

/** Academic year of senior-year courses, which go in the degree's last two semesters. */
export const SENIOR_YEAR = 4;

/**
 * Senior projects and theses, in any major: CSE 495/496, HON 495/496, a
 * capstone. Their requirement may not say "senior", so the course itself does.
 */
export function isSeniorCourse(course: Pick<CourseRecord, "code" | "title">): boolean {
  return Number(course.code.split(" ")[1]) >= 495 && /senior|thesis|capstone|project/i.test(course.title);
}

/**
 * The first semester (an index, as from semesterIndex) of an academic year,
 * two semesters a year. Senior year is the degree's last two semesters,
 * however many there are; a course that runs only in the other season starts
 * one sooner, so a two-part project (495 then 496) still fits. Earlier years
 * start no later than senior year does.
 */
export function yearStart(student: StudentRecord, year: number, seasons?: Season[] | null): number {
  const lastTwo = Math.max(0, targetTerms(student) - 2);
  if (year < SENIOR_YEAR) return Math.min((year - 1) * 2, lastTwo);
  const first = degreeTerms(student)[lastTwo];
  return seasons?.length && first && !seasons.includes(parseTerm(first).season) ? Math.max(0, lastTwo - 1) : lastTwo;
}

/**
 * Whether a course runs in a term's season, judged by that season's schedule.
 * Without a complete schedule for the season (a partial scrape), anything may run.
 */
export function offeredIn(ctx: PlanContext, course: CourseRecord, term: TermId): boolean {
  const offered = ctx.offeredBySeason[parseTerm(term).season];
  return !offered || offered.has(course.code);
}

// ---------------------------------------------------------------------------
// Checking a plan
// ---------------------------------------------------------------------------

export type ScheduleStatus = "scheduled" | "not-scheduled" | "unknown";

export interface CheckedItem {
  /** Course code, or null for a free elective, an SBC placeholder, or an elective slot. */
  code: CourseCode | null;
  /** The SBC of a placeholder; null otherwise. */
  sbc: SbcCode | null;
  /**
   * For an elective slot: the requirement, others the same course can count
   * toward, and the concentration it's in (declared, or the closest). Null otherwise.
   */
  slot: { requirementId: string; also: string[]; option?: SlotOption } | null;
  title: string;
  credits: number;
  schedule: ScheduleStatus;
  /** Problems with taking this course in this term. */
  problems: string[];
  /** Prerequisite conditions that can't be checked, e.g. instructor permission. */
  checks: string[];
  /** Requirements this course counts toward once the whole plan is taken. */
  counts: string[];
}

export type SlotOption = NonNullable<Extract<MissingItem, { kind: "choose" }>["option"]>;

export interface CheckedTerm {
  term: TermId;
  credits: number;
  items: CheckedItem[];
  /** Load problems for the term as a whole. */
  problems: string[];
}

/** True when an unmet course prerequisite is allowed concurrently and is planned in the same term. */
function concurrentlyMet(expr: Prereq | undefined, sameTerm: Set<CourseCode>): boolean {
  if (!expr) return false;
  if (expr.type === "course") return !!expr.concurrentAllowed && sameTerm.has(expr.code);
  if (expr.type === "and" || expr.type === "or") return expr.of.some((e) => concurrentlyMet(e, sameTerm));
  return false;
}

export function checkPlan(ctx: PlanContext, plan: PlannedTerm[]): { terms: CheckedTerm[]; projection: PlanProjection } {
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const base = audit(ctx, ctx.student);
  const retakes = new Set(base.programs.flatMap((p) => p.retakes));
  const alreadyTaken = new Set(usableAttempts(ctx.student.attempts).map((a) => a.code).filter((c) => !retakes.has(c)));
  const majorSubjects = base.programs.filter((p) => p.program.kind === "major").map((p) => primarySubject(p.program));

  const projection = projectPlan(ctx, plan);
  const minCredits = minTermCredits(ctx.student);
  const seen = new Set<CourseCode>();
  const seenSbc = new Set<SbcCode>();
  const sbcNames = new Map(ctx.sbcCategories.map((c) => [c.code, c.name]));
  const requirements = requirementIndex(ctx);
  let creditsBefore = base.credits.earned + base.credits.inProgress;

  const terms = plan.map((t): CheckedTerm => {
    const before = withPlan(ctx.student, plan.filter((p) => termOrdinal(p.term) < termOrdinal(t.term)));
    const index = buildCompletionIndex(before.attempts, { includeInProgress: true });
    const sameTerm = new Set(t.items.flatMap((i) => ("code" in i ? [i.code] : [])));
    const standing = standingFor(creditsBefore);
    const sections = ctx.sectionsByTerm.get(t.term);

    const items = t.items.map((item): CheckedItem => {
      const placeholder: Omit<CheckedItem, "title" | "credits"> = { code: null, sbc: null, slot: null, schedule: "unknown", problems: [], checks: [], counts: [] };
      if ("elective" in item) return { ...placeholder, title: "Elective", credits: item.elective };
      if ("slot" in item) {
        const found = requirements.get(item.slot);
        const also = item.also ?? [];
        const option = projection.slotOptions.get(item.slot);
        return {
          ...placeholder,
          slot: { requirementId: item.slot, also, ...(option && { option }) },
          title: option ? `${option.label} ${option.kind}` : (found?.requirement.title ?? "Elective"),
          credits: item.credits,
          counts: [item.slot, ...also].flatMap((id) => {
            const r = requirements.get(id);
            return r ? [`${formatProgramName(r.program.name)}: ${requirementHeading(r.requirement)}`] : [];
          }),
          problems: found ? [] : ["This requirement isn't in your programs anymore"],
        };
      }
      if ("sbc" in item) {
        const problems = [
          ...(projection.sbcMet.includes(item.sbc) ? [`${item.sbc} is already covered`] : []),
          ...(seenSbc.has(item.sbc) ? ["Planned twice"] : []),
        ];
        seenSbc.add(item.sbc);
        return {
          ...placeholder,
          sbc: item.sbc,
          title: sbcNames.get(item.sbc) ?? `${item.sbc} course`,
          credits: SBC_PLACEHOLDER_CREDITS,
          problems,
        };
      }
      const course = catalog.get(item.code);
      const problems: string[] = [];
      if (!course) problems.push("Not in the course catalog");
      if (alreadyTaken.has(item.code)) problems.push("Already taken");
      else if (seen.has(item.code)) problems.push("Planned twice");
      seen.add(item.code);
      const prereqs = evaluatePrereq(course?.prerequisites, { index, standing, majorSubjects });
      if (!prereqs.met && !concurrentlyMet(course?.prerequisites, sameTerm)) {
        problems.push(`Prerequisites: ${formatPrereq(course?.prerequisites)}`);
      }
      // A paired course counts when it, or a course equivalent to it, is taken before or in the same term.
      const pair = course && pairedCorequisite(course);
      const pairEquivalents = new Set([pair, ...(pair ? (catalog.get(pair)?.equivalents ?? []) : [])]);
      const covered = [...sameTerm, ...index.keys()].some((c) => pairEquivalents.has(c) || catalog.get(c)?.equivalents.includes(pair ?? ""));
      if (pair && !covered) problems.push(`Take with ${pair}`);
      return {
        code: item.code,
        sbc: null,
        slot: null,
        title: course?.title ?? "",
        credits: course ? plannedCredits(course) : 0,
        schedule: !sections ? "unknown" : sections.has(item.code) ? "scheduled" : "not-scheduled",
        problems,
        checks: prereqs.unverifiable,
        counts: projection.countsByCourse.get(item.code) ?? [],
      };
    });

    const credits = items.reduce((s, i) => s + i.credits, 0);
    creditsBefore += credits;
    // The minimum is for fall and spring; summer and winter sessions are usually lighter.
    const regular = t.term.endsWith("FA") || t.term.endsWith("SP");
    const problems = [
      ...(credits > MAX_TERM_CREDITS ? [`Over ${MAX_TERM_CREDITS} credits needs approval`] : []),
      ...(regular && credits < minCredits ? [`Under your ${minCredits}-credit minimum`] : []),
    ];
    return { term: t.term, credits, items, problems };
  });

  return { terms, projection };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface PlanProjection {
  programs: { id: string; name: string; done: number; total: number }[];
  sbc: { done: number; total: number };
  /** SBCs that completed and planned courses cover, not counting placeholders. */
  sbcMet: SbcCode[];
  credits: { planned: number; required: number };
  upperDivision: { planned: number; required: number };
  /** Requirement titles each planned course counts toward. */
  countsByCourse: Map<CourseCode, string[]>;
  /** Last planned term, when the plan completes every requirement and the credit total. */
  graduation: TermId | null;
  /** Requirements still open after the whole plan. */
  open: string[];
  /** Requirements only an advisor can confirm. */
  review: string[];
  /** Requirement id → the concentration its open pool belongs to, for naming elective slots. */
  slotOptions: Map<string, SlotOption>;
}

/** Requirement id → the requirement and its program, for every program in the catalog. */
function requirementIndex(ctx: PlanContext) {
  return new Map(ctx.programs.flatMap((program) => program.requirements.map((requirement) => [requirement.id, { program, requirement }] as const)));
}

/** Slot credits planned toward each requirement, counting a slot for every requirement it can count toward. */
export function slotCredits(plan: PlannedTerm[]): Map<string, number> {
  const credits = new Map<string, number>();
  for (const item of plan.flatMap((t) => t.items)) {
    if (!("slot" in item)) continue;
    for (const id of [item.slot, ...(item.also ?? [])]) credits.set(id, (credits.get(id) ?? 0) + item.credits);
  }
  return credits;
}

/** Credits of elective slots whose pools take only 300-level and above courses. */
function upperDivisionSlotCredits(result: DegreeAudit, plan: PlannedTerm[]): number {
  const requirements = new Map(result.programs.flatMap((p) => p.requirements.map((r) => [r.requirement.id, r])));
  return plan
    .flatMap((t) => t.items)
    .reduce((sum, item) => {
      if (!("slot" in item)) return sum;
      const pools = requirements.get(item.slot)?.missing.flatMap((m) => (m.kind === "choose" ? [m.pool] : [])) ?? [];
      return pools.length > 0 && pools.every(isUpperDivisionPool) ? sum + item.credits : sum;
    }, 0);
}

/** True when every open item of a requirement is a pool the planned slots cover (three credits a course). */
function coveredBySlots(missing: MissingItem[], slots: number): boolean {
  if (slots <= 0 || missing.some((m) => m.kind !== "choose")) return false;
  const needed = missing.reduce((s, m) => s + (m.kind === "choose" ? (m.unit === "credits" ? m.remaining : m.remaining * 3) : 0), 0);
  return needed <= slots;
}

export function projectPlan(ctx: PlanContext, plan: PlannedTerm[]): PlanProjection {
  const planned = new Set(plan.flatMap((t) => t.items.flatMap((i) => ("code" in i ? [i.code] : []))));
  const result = audit(ctx, withPlan(ctx.student, plan));
  const slots = slotCredits(plan);
  const done = (r: DegreeAudit["programs"][number]["requirements"][number]) =>
    isDone(r.status) || coveredBySlots(r.missing, slots.get(r.requirement.id) ?? 0);
  const sbcOpen = openSbc(result, sbcPlaceholders(plan));

  const countsByCourse = new Map<CourseCode, string[]>();
  const add = (code: CourseCode, label: string) => {
    if (planned.has(code)) countsByCourse.set(code, [...(countsByCourse.get(code) ?? []), label]);
  };
  for (const p of result.programs) {
    for (const r of p.requirements) r.applied.forEach((a) => add(a.code, requirementHeading(r.requirement)));
  }
  for (const s of result.sbc.results) if (s.appliedCode) add(s.appliedCode, s.category.code);

  const open = [
    ...result.programs.flatMap((p) =>
      p.requirements
        .filter((r) => !done(r) && !isReview(r.status))
        .map((r) => `${formatProgramName(p.program.name)}: ${requirementHeading(r.requirement)}`),
    ),
    ...sbcOpen.map((r) => `SBC ${r.category.code}`),
  ];
  const review = result.programs.flatMap((p) =>
    p.requirements.filter((r) => isReview(r.status)).map((r) => `${formatProgramName(p.program.name)}: ${requirementHeading(r.requirement)}`),
  );
  const electives = electiveCredits(plan);
  const credits = result.credits.earned + result.credits.inProgress + electives;
  const complete = open.length === 0 && credits >= result.credits.required;

  return {
    programs: result.programs.map((p) => ({
      id: p.program.id,
      name: formatProgramName(p.program.name),
      done: p.requirements.filter((r) => done(r)).length,
      total: p.requirements.length,
    })),
    sbc: { done: result.sbc.total - Math.min(result.sbc.total, sbcOpen.length), total: result.sbc.total },
    sbcMet: result.sbc.results.filter((r) => isDone(r.status)).map((r) => r.category.code),
    credits: { planned: credits, required: result.credits.required },
    upperDivision: {
      planned: result.credits.upperDivision.earned + result.credits.upperDivision.inProgress + upperDivisionSlotCredits(result, plan),
      required: result.credits.upperDivision.required,
    },
    countsByCourse,
    graduation: complete && plan.length > 0 ? plan[plan.length - 1].term : null,
    slotOptions: new Map(
      result.programs.flatMap((p) =>
        p.requirements.flatMap((r) => {
          const option = r.missing.find((m) => m.kind === "choose" && m.option);
          return option?.kind === "choose" && option.option ? [[r.requirement.id, option.option] as const] : [];
        }),
      ),
    ),
    open,
    review,
  };
}
