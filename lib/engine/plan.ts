/**
 * Multi-term plans: generate one, check it, and project what it completes.
 *
 * Planned courses are modeled as in-progress attempts in their term, so the
 * audit and prerequisite checks treat them as "will be passed". Free
 * electives have no course code and only add credits. SBC placeholders add
 * credits and count their SBC as planned.
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
  mandatoryCourses,
  matchesSelector,
  requiredByOthers,
  runDegreeAudit,
  summarizeCredits,
  type DegreeAudit,
  type ProgramAudit,
  type SbcResult,
} from "./audit";
import { requirementHeading } from "./describe";
import { prerequisiteChecker, primarySubject, replacedByOtherPrograms } from "./planner";
import {
  buildCompletionIndex,
  evaluatePrereq,
  formatPrereq,
  pairedCorequisite,
  plannedCredits,
  referencedCourses,
  standingFor,
  usableAttempts,
} from "./prerequisites";

/** Above this, Stony Brook requires approval for the term's load. */
export const MAX_TERM_CREDITS = 19;
/** Below this, a fall or spring term is part-time; the default minimum per term. */
export const FULL_TIME_CREDITS = 12;
const ELECTIVE_CREDITS = 3;
/** Credits planned for an SBC placeholder; upper-tier SBCs need at least 3. */
export const SBC_PLACEHOLDER_CREDITS = 3;
/** The most credits the generator plans in a term. */
const GENERATED_MAX_CREDITS = 18;

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

/** Credits for an item without a course code: an elective or an SBC placeholder. */
function placeholderCredits(item: PlanItem): number {
  return "elective" in item ? item.elective : "sbc" in item ? SBC_PLACEHOLDER_CREDITS : 0;
}

function electiveCredits(plan: PlannedTerm[]): number {
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
function sbcToPlace(a: DegreeAudit): SbcCode[] {
  const open = openSbc(a);
  const isDeeper = (r: SbcResult) => DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeperDone = a.sbc.results.filter((r) => isDeeper(r) && isDone(r.status)).length;
  const deeper = open.filter(isDeeper).slice(0, Math.max(0, DEEPER_UNDERSTANDING.required - deeperDone));
  return open.filter((r) => !isDeeper(r) || deeper.includes(r)).map((r) => r.category.code);
}

function openProgramCount(a: DegreeAudit): number {
  return a.programs.flatMap((p) => p.requirements).filter((r) => !isDone(r.status) && !isReview(r.status)).length;
}

/** About how many courses the programs still need: one per missing course, the remaining count of each pool. */
function openCourseCount(a: DegreeAudit): number {
  let count = 0;
  for (const r of a.programs.flatMap((p) => p.requirements)) {
    if (isDone(r.status) || isReview(r.status)) continue;
    for (const item of r.missing) {
      if (item.kind === "course") count++;
      else if (item.kind === "choose") count += item.unit === "courses" ? item.remaining : Math.ceil(item.remaining / ELECTIVE_CREDITS);
    }
  }
  return count;
}

/** The student's minimum credits for a fall or spring term. */
export function minTermCredits(student: StudentRecord): number {
  return student.minTermCredits ?? FULL_TIME_CREDITS;
}

/** A degree is planned as eight fall and spring semesters. */
export const DEGREE_TERMS = 8;
/** Terms the generator may add after the four years when requirements are still open. */
const EXTRA_TERMS = 4;

/** The eight fall/spring semesters from the student's first one. */
export function fourYearTerms(student: StudentRecord): TermId[] {
  const entry = student.entryTerm;
  let term = entry.endsWith("FA") || entry.endsWith("SP") ? entry : nextRegularTerm(entry);
  const terms: TermId[] = [];
  for (let i = 0; i < DEGREE_TERMS; i++, term = nextRegularTerm(term)) terms.push(term);
  return terms;
}

/**
 * Whether a course runs in a term's season, judged by that season's schedule.
 * Without a complete schedule for the season (a partial scrape), anything may run.
 */
function offeredIn(ctx: PlanContext, course: CourseRecord, term: TermId): boolean {
  const offered = ctx.offeredBySeason[parseTerm(term).season];
  return !offered || offered.has(course.code);
}

/**
 * Fills the empty fall and spring semesters of a four-year degree, keeping every
 * term the student has already planned. Each term takes the courses the
 * student's programs need that run that season, lowest-numbered first, until
 * the term reaches its share of the remaining credits; open SBCs then become
 * placeholders, and electives fill the rest. Terms after the four years are
 * added only while requirements remain.
 */
export function generatePlan(ctx: PlanContext): PlannedTerm[] {
  const { student } = ctx;
  const minCredits = minTermCredits(student);
  const maxCredits = Math.max(GENERATED_MAX_CREDITS, minCredits);
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const itemCredits = (i: PlanItem) => {
    const course = "code" in i ? catalog.get(i.code) : undefined;
    return course ? plannedCredits(course) : placeholderCredits(i);
  };
  const after = (t: TermId) => termOrdinal(t) > termOrdinal(student.currentTerm);

  let plan = student.plan.filter((t) => t.items.length > 0);
  const keptTerms = new Set(plan.map((t) => t.term));
  const toFill = fourYearTerms(student).filter((t) => after(t) && !keptTerms.has(t));
  let extra = 0;
  let next = nextRegularTerm(fourYearTerms(student).at(-1)!);

  for (let i = 0; i < toFill.length; i++) {
    const term = toFill[i];
    const termsLeft = toFill.length - i;
    const planned = audit(ctx, withPlan(student, plan));
    const before = plan.filter((t) => termOrdinal(t.term) < termOrdinal(term));
    const studentBefore = withPlan(student, before);
    const auditBefore = audit(ctx, studentBefore);
    const prereqsMet = prerequisiteChecker(auditBefore, studentBefore);
    const standing = Number(standingFor(auditBefore.credits.earned + auditBefore.credits.inProgress).slice(1));

    const creditsLeft = planned.credits.required - planned.credits.earned - planned.credits.inProgress - electiveCredits(plan);
    // Heavier terms while lots of program work remains, so senior sequences (CSE 495 → 496) still fit in four years.
    const workLeft = openCourseCount(planned) * ELECTIVE_CREDITS;
    const target = Math.min(maxCredits, Math.max(minCredits, Math.ceil(creditsLeft / termsLeft), Math.ceil(workLeft / termsLeft)));

    const items = pickProgramCourses(ctx, plan, planned, term, target, maxCredits, (c) => prereqsMet(c).met, standing, termsLeft);
    const madeProgress = items.length > 0 || creditsLeft > 0;
    let credits = items.reduce((s, item) => s + itemCredits(item), 0);

    // Spread the open SBCs over the remaining terms, then fill with electives.
    const withTerm = audit(ctx, withPlan(student, [...plan, { term, items }]));
    const placed = sbcPlaceholders(plan);
    const sbcs = sbcToPlace(withTerm).filter((s) => !placed.has(s));
    for (const sbc of sbcs.slice(0, Math.ceil(sbcs.length / termsLeft))) {
      if (credits + SBC_PLACEHOLDER_CREDITS > maxCredits) break;
      items.push({ sbc });
      credits += SBC_PLACEHOLDER_CREDITS;
    }
    // Credits still needed with this term's courses in (a planned retake replaces its earlier credits).
    let stillNeeded =
      withTerm.credits.required - withTerm.credits.earned - withTerm.credits.inProgress - electiveCredits(plan) -
      items.reduce((s, item) => s + ("code" in item ? 0 : itemCredits(item)), 0);
    // Reach the target even if that overshoots it a little; rounding down every term would leave credits short at
    // the end. The last term also covers whatever is still needed.
    while (credits < target || credits < minCredits || (termsLeft === 1 && stillNeeded > 0)) {
      if (credits + ELECTIVE_CREDITS > MAX_TERM_CREDITS) break;
      stillNeeded -= ELECTIVE_CREDITS;
      items.push({ elective: ELECTIVE_CREDITS });
      credits += ELECTIVE_CREDITS;
    }
    plan = [...plan, { term, items }].sort((a, b) => termOrdinal(a.term) - termOrdinal(b.term));

    // Past four years, keep going only while requirements are open and terms still make progress on them.
    if (extra > 0 && !madeProgress) {
      plan = plan.filter((t) => t.term !== term);
      break;
    }
    const after4 = audit(ctx, withPlan(student, plan));
    const short = after4.credits.required - after4.credits.earned - after4.credits.inProgress - electiveCredits(plan) > 0;
    if (i === toFill.length - 1 && extra < EXTRA_TERMS && (openProgramCount(after4) > 0 || short)) {
      while (keptTerms.has(next)) next = nextRegularTerm(next);
      toFill.push(next);
      next = nextRegularTerm(next);
      extra++;
    }
  }

  // A placeholder placed before a real course that turned out to carry its SBC (WRT 102 for WRT) becomes an elective.
  const generated = new Set(toFill);
  const covered = new Set(
    audit(ctx, withPlan(student, plan)).sbc.results.filter((r) => isDone(r.status)).map((r) => r.category.code),
  );
  return plan.map((t) =>
    generated.has(t.term)
      ? { ...t, items: t.items.map((i): PlanItem => ("sbc" in i && covered.has(i.sbc) ? { elective: SBC_PLACEHOLDER_CREDITS } : i)) }
      : t,
  );
}

/** Compares rank tuples element by element. */
function compareRanks(x: number[], y: number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * One term's program courses: every course the programs need that the student
 * can take this term and that runs this season, lowest level first (100s, then
 * 200s, …). Within a level, the student's program order and then the
 * requirement order break ties.
 */
function pickProgramCourses(
  ctx: PlanContext,
  plan: PlannedTerm[],
  planned: DegreeAudit,
  term: TermId,
  target: number,
  maxCredits: number,
  prereqsMet: (course: CourseRecord) => boolean,
  /** Class standing before the term, 1 (U1) to 4 (U4). */
  standing: number,
  /** Terms left to fill, this one included. */
  termsLeft: number,
): PlanItem[] {
  const { student } = ctx;
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const replaced = replacedByOtherPrograms(planned);
  // Courses the student has, is taking, or has planned, except retakes; and anything that can't count alongside them.
  const retakes = new Set(planned.programs.flatMap((p) => p.retakes));
  const unavailable = new Set(
    usableAttempts(withPlan(student, plan).attempts)
      .map((a) => a.code)
      .filter((c) => !retakes.has(c)),
  );
  for (const code of [...unavailable]) catalog.get(code)?.equivalents.forEach((e) => unavailable.add(e));

  const picked: CourseRecord[] = [];
  const takeable = (c: CourseRecord | undefined): c is CourseRecord =>
    !!c &&
    !unavailable.has(c.code) &&
    !replaced.has(c.code) &&
    !picked.some((p) => p.code === c.code || p.equivalents.includes(c.code)) &&
    offeredIn(ctx, c, term) &&
    // At most one level above standing: no 400-level courses for a first-year student.
    Math.floor(Number(c.code.split(" ")[1]) / 100) <= standing + 1 &&
    prereqsMet(c);
  /** Takeable, and so is the course it must be taken with (a lab waits for its lecture). */
  const usable = (c: CourseRecord | undefined): c is CourseRecord => {
    if (!takeable(c)) return false;
    const pair = pairedCorequisite(c);
    return !pair || unavailable.has(pair) || picked.some((p) => p.code === pair) || takeable(catalog.get(pair));
  };
  const onItsWay = (code: CourseCode) => unavailable.has(code) || picked.some((p) => p.code === code);

  // Every course a program requires outright; elective picks never use up one of these through an equivalent.
  const mandatory = new Set(planned.programs.flatMap((p) => p.program.requirements.flatMap((r) => mandatoryCourses(r.rule))));

  // When a program lists alternatives ("CSE 113 or CSE 150"), prefer the one another program requires.
  const requiredElsewhere = (program: ProgramAudit) =>
    requiredByOthers(
      program.program,
      planned.programs.map((p) => p.program),
    );

  /**
   * A course that isn't taken yet, or the first missing prerequisite on the way
   * to it (up to two levels): WRT 102 before CSE 300. Of alternatives ("CSE 216
   * or CSE 260 or CSE 307"), none is pursued when one is already taken, planned,
   * or required by a program anyway.
   */
  const reachable = (code: CourseCode, depth = 0): CourseRecord | undefined => {
    const course = catalog.get(code);
    if (!course || unavailable.has(code) || replaced.has(code)) return undefined;
    if (usable(course)) return course;
    return depth < 2 ? missingPrerequisite(catalog.get(code)?.prerequisites, depth + 1) : undefined;
  };
  const missingPrerequisite = (expr: Prereq | undefined, depth: number): CourseRecord | undefined => {
    if (!expr) return undefined;
    if (expr.type === "course") return onItsWay(expr.code) ? undefined : reachable(expr.code, depth);
    if (expr.type === "or" && expr.of.some((e) => e.type === "course" && (onItsWay(e.code) || mandatory.has(e.code)))) return undefined;
    if (expr.type === "and" || expr.type === "or") {
      for (const e of expr.of) {
        const found = missingPrerequisite(e, depth);
        if (found) return found;
      }
    }
    return undefined;
  };

  const order = (p: ProgramAudit) => {
    const i = student.programIds.indexOf(p.program.id);
    return i === -1 ? Infinity : i;
  };
  const programs = [...planned.programs].sort((a, b) => order(a) - order(b));

  interface Candidate {
    course: CourseRecord;
    /** The requirement item it fills; an item takes at most `limit` courses this term. */
    key: string;
    limit: number;
    /** The other ways to fill the item; once one is planned, the rest are skipped. */
    alternatives: CourseCode[];
    rank: number[];
  }
  const candidates: Candidate[] = [];
  const level = (c: CourseRecord) => Math.floor(Number(c.code.split(" ")[1]) / 100);

  programs.forEach((p, programIndex) => {
    const sample = new Set(
      (p.program.sampleSequence ?? []).flatMap((t) => t.slots.flatMap((s) => (s.kind === "course" ? [s.code, ...(s.alternatives ?? [])] : []))),
    );
    const elsewhere = requiredElsewhere(p);
    p.requirements.forEach((r, requirementIndex) => {
      if (isDone(r.status) || isReview(r.status)) return;
      const add = (course: CourseRecord, key: string, limit: number, alternatives: CourseCode[] = []) =>
        candidates.push({ course, key, limit, alternatives, rank: [level(course), programIndex, requirementIndex, Number(course.code.split(" ")[1])] });

      r.missing.forEach((item, index) => {
        const key = `${r.requirement.id}#${index}`;
        if (item.kind === "course") {
          if (item.options.some(onItsWay)) return;
          // An option another program requires is the only one worth taking (CSE 150 over CSE 113 for Honors CS).
          const open = item.options.filter((c) => !replaced.has(c));
          const options = open.some((c) => elsewhere.has(c)) ? open.filter((c) => elsewhere.has(c)) : open;
          const direct = options.map((c) => catalog.get(c)).filter(usable);
          direct.forEach((c) => add(c, key, 1, options));
          // Nothing takeable yet: plan what it's waiting on instead (WRT 102 before CSE 300).
          const prerequisite = direct.length === 0 ? options.map((c) => reachable(c)).find(Boolean) : undefined;
          if (prerequisite) add(prerequisite, `${key}:prerequisite`, 1);
        } else if (item.kind === "choose") {
          const remaining = item.unit === "courses" ? item.remaining : Math.ceil(item.remaining / ELECTIVE_CREDITS);
          const capped = (c: CourseRecord) => item.constraints.some((k) => k.type === "maxFrom" && matchesSelector(c.code, c, k.from));
          const listed = item.pool.courses ?? [];
          const preference = (c: CourseRecord) => [listed.includes(c.code) ? listed.indexOf(c.code) : listed.length, sample.has(c.code) ? 0 : 1];
          ctx.courses
            .filter(
              (c) =>
                !item.exclude.includes(c.code) &&
                matchesSelector(c.code, c, item.pool) &&
                !capped(c) &&
                !c.equivalents.some((e) => mandatory.has(e)) &&
                usable(c),
            )
            .sort((a, b) => {
              const [x, y] = [preference(a), preference(b)];
              return x[0] - y[0] || x[1] - y[1] || level(a) - level(b);
            })
            .slice(0, remaining)
            .forEach((c) => add(c, key, remaining));
        }
      });
    });
  });

  // Deadlines: a course that starts a chain of still-needed courses (CSE 495 → CSE 496) goes first once
  // the remaining terms are only just enough for the chain.
  const needed = new Set([
    ...candidates.map((c) => c.course.code),
    ...programs.flatMap((p) => p.requirements.flatMap((r) => r.missing.flatMap((m) => (m.kind === "course" ? m.options : [])))),
  ]);
  const dependents = new Map<CourseCode, CourseCode[]>();
  for (const code of needed) {
    for (const pre of referencedCourses(catalog.get(code)?.prerequisites)) dependents.set(pre, [...(dependents.get(pre) ?? []), code]);
  }
  const depthMemo = new Map<CourseCode, number>();
  const chainDepth = (code: CourseCode, seen = new Set<CourseCode>()): number => {
    if (depthMemo.has(code)) return depthMemo.get(code)!;
    if (seen.has(code)) return 0;
    seen.add(code);
    const depth = Math.max(0, ...(dependents.get(code) ?? []).map((d) => 1 + chainDepth(d, seen)));
    depthMemo.set(code, depth);
    return depth;
  };
  for (const c of candidates) {
    const depth = chainDepth(c.course.code);
    c.rank.unshift(depth > 0 && depth >= termsLeft - 1 ? 0 : 1);
  }
  candidates.sort((a, b) => compareRanks(a.rank, b.rank));

  const pickedFor = new Map<string, number>();
  let credits = 0;
  for (const candidate of candidates) {
    if (credits >= target) break;
    const { course, key, limit, alternatives } = candidate;
    if ((pickedFor.get(key) ?? 0) >= limit || alternatives.some((c) => c !== course.code && onItsWay(c)) || !usable(course)) continue;
    // A lecture and its lab go into the same term.
    const pairCode = pairedCorequisite(course);
    const pair = pairCode ? catalog.get(pairCode) : undefined;
    const group = [course, ...(pair && usable(pair) ? [pair] : [])];
    const groupCredits = group.reduce((s, c) => s + plannedCredits(c), 0);
    if (credits + groupCredits > maxCredits) continue;
    picked.push(...group);
    pickedFor.set(key, (pickedFor.get(key) ?? 0) + 1);
    credits += groupCredits;
  }
  return picked.map((c) => ({ code: c.code }));
}

// ---------------------------------------------------------------------------
// Checking a plan
// ---------------------------------------------------------------------------

export type ScheduleStatus = "scheduled" | "not-scheduled" | "unknown";

export interface CheckedItem {
  /** Course code, or null for a free elective or an SBC placeholder. */
  code: CourseCode | null;
  /** The SBC of a placeholder; null otherwise. */
  sbc: SbcCode | null;
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
  let creditsBefore = base.credits.earned + base.credits.inProgress;

  const terms = plan.map((t): CheckedTerm => {
    const before = withPlan(ctx.student, plan.filter((p) => termOrdinal(p.term) < termOrdinal(t.term)));
    const index = buildCompletionIndex(before.attempts, { includeInProgress: true });
    const sameTerm = new Set(t.items.flatMap((i) => ("code" in i ? [i.code] : [])));
    const standing = standingFor(creditsBefore);
    const sections = ctx.sectionsByTerm.get(t.term);

    const items = t.items.map((item): CheckedItem => {
      const placeholder: Omit<CheckedItem, "title" | "credits"> = { code: null, sbc: null, schedule: "unknown", problems: [], checks: [], counts: [] };
      if ("elective" in item) return { ...placeholder, title: "Elective", credits: item.elective };
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
}

export function projectPlan(ctx: PlanContext, plan: PlannedTerm[]): PlanProjection {
  const planned = new Set(plan.flatMap((t) => t.items.flatMap((i) => ("code" in i ? [i.code] : []))));
  const result = audit(ctx, withPlan(ctx.student, plan));
  const done = isDone;
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
        .filter((r) => !done(r.status) && !isReview(r.status))
        .map((r) => `${p.program.name}: ${requirementHeading(r.requirement)}`),
    ),
    ...sbcOpen.map((r) => `SBC ${r.category.code}`),
  ];
  const review = result.programs.flatMap((p) =>
    p.requirements.filter((r) => isReview(r.status)).map((r) => `${p.program.name}: ${requirementHeading(r.requirement)}`),
  );
  const electives = electiveCredits(plan);
  const credits = result.credits.earned + result.credits.inProgress + electives;
  const complete = open.length === 0 && credits >= result.credits.required;

  return {
    programs: result.programs.map((p) => ({
      id: p.program.id,
      name: p.program.name,
      done: p.requirements.filter((r) => done(r.status)).length,
      total: p.requirements.length,
    })),
    sbc: { done: result.sbc.total - Math.min(result.sbc.total, sbcOpen.length), total: result.sbc.total },
    sbcMet: result.sbc.results.filter((r) => isDone(r.status)).map((r) => r.category.code),
    credits: { planned: credits, required: result.credits.required },
    upperDivision: {
      planned: result.credits.upperDivision.earned + result.credits.upperDivision.inProgress,
      required: result.credits.upperDivision.required,
    },
    countsByCourse,
    graduation: complete && plan.length > 0 ? plan[plan.length - 1].term : null,
    open,
    review,
  };
}
