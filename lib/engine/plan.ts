/**
 * Multi-term plans: generate one, check it, and project what it completes.
 *
 * Planned courses are modeled as in-progress attempts in their term, so the
 * audit and the next-semester proposer treat them as "will be passed". Free
 * electives have no course code and only add credits.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import { nextRegularTerm, termOrdinal } from "@/lib/domain/terms";
import type { CourseAttempt, CourseCode, PlannedTerm, SbcCategory, StudentRecord, TermId } from "@/lib/domain/types";
import { DEEPER_UNDERSTANDING, runDegreeAudit, summarizeCredits, type DegreeAudit, type SbcResult } from "./audit";
import { requirementHeading } from "./describe";
import { primarySubject, proposeNextSemester } from "./planner";
import { buildCompletionIndex, evaluatePrereq, formatPrereq, plannedCredits, standingFor, usableAttempts } from "./prerequisites";

/** Above this, Stony Brook requires approval for the term's load. */
export const MAX_TERM_CREDITS = 19;
/** Below this, a fall or spring term is part-time. */
export const FULL_TIME_CREDITS = 12;
const ELECTIVE_CREDITS = 3;

export interface PlanContext {
  student: StudentRecord;
  programs: ProgramDefinition[];
  courses: CourseRecord[];
  sbcCategories: SbcCategory[];
  creditRules: Parameters<typeof summarizeCredits>[2];
  /** Main-campus sections per course for terms with schedule data; a missing term means unknown. */
  sectionsByTerm: Map<TermId, Map<CourseCode, number>>;
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

function electiveCredits(plan: PlannedTerm[]): number {
  return plan.flatMap((t) => t.items).reduce((s, i) => s + ("elective" in i ? i.elective : 0), 0);
}

const isDone = (status: string) => status === "satisfied" || status === "in-progress" || status === "exempt";
/** Only an advisor can settle these; no planned course will. */
const isReview = (status: string) => status === "needs-review";

/**
 * SBC objectives still open, counting planned courses as done. Only three of the
 * four Pursue Deeper Understanding categories are required.
 */
function openSbc(a: DegreeAudit): SbcResult[] {
  const isDeeper = (r: SbcResult) => DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeperDone = a.sbc.results.filter((r) => isDeeper(r) && isDone(r.status)).length;
  return a.sbc.results.filter(
    (r) => !isDone(r.status) && !(isDeeper(r) && deeperDone >= DEEPER_UNDERSTANDING.required),
  );
}

function openCount(a: DegreeAudit): number {
  return a.programs.flatMap((p) => p.requirements).filter((r) => !isDone(r.status) && !isReview(r.status)).length + openSbc(a).length;
}

/**
 * Fills fall and spring terms after the current one, a term at a time, with the
 * next-semester proposal given everything planned before it. Free electives top
 * up each term once requirement courses run out, until the credit total is met.
 */
export function generatePlan(ctx: PlanContext, { maxTerms = 8, targetCredits = 15 } = {}): PlannedTerm[] {
  const plan: PlannedTerm[] = [];
  let term = nextRegularTerm(ctx.student.currentTerm);
  for (let i = 0; i < maxTerms; i++) {
    const student = withPlan(ctx.student, plan);
    const current = audit(ctx, student);
    const creditsLeft =
      current.credits.required - current.credits.earned - current.credits.inProgress - electiveCredits(plan);
    if (openCount(current) === 0 && creditsLeft <= 0) break;

    const proposal = proposeNextSemester({
      audit: current,
      student,
      courses: ctx.courses,
      term,
      sectionCounts: ctx.sectionsByTerm.get(term) ?? null,
      targetCredits,
    });
    const items: PlannedTerm["items"] = proposal.courses.map((p) => ({ code: p.course.code }));
    let credits = proposal.totalCredits;
    let left = creditsLeft - credits;
    // Top up to the target, going over it (to the usual 18-credit cap) rather than under.
    while (credits < targetCredits && credits + ELECTIVE_CREDITS <= 18 && left > 0) {
      items.push({ elective: ELECTIVE_CREDITS });
      credits += ELECTIVE_CREDITS;
      left -= ELECTIVE_CREDITS;
    }
    if (items.length === 0) break;
    plan.push({ term, items });
    term = nextRegularTerm(term);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Checking a plan
// ---------------------------------------------------------------------------

export type ScheduleStatus = "scheduled" | "not-scheduled" | "unknown";

export interface CheckedItem {
  /** Course code, or null for a free elective. */
  code: CourseCode | null;
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
  const seen = new Set<CourseCode>();
  let creditsBefore = base.credits.earned + base.credits.inProgress;

  const terms = plan.map((t): CheckedTerm => {
    const before = withPlan(ctx.student, plan.filter((p) => termOrdinal(p.term) < termOrdinal(t.term)));
    const index = buildCompletionIndex(before.attempts, { includeInProgress: true });
    const sameTerm = new Set(t.items.flatMap((i) => ("code" in i ? [i.code] : [])));
    const standing = standingFor(creditsBefore);
    const sections = ctx.sectionsByTerm.get(t.term);

    const items = t.items.map((item): CheckedItem => {
      if ("elective" in item) {
        return { code: null, title: "Elective", credits: item.elective, schedule: "unknown", problems: [], checks: [], counts: [] };
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
      return {
        code: item.code,
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
    const regular = t.term.endsWith("FA") || t.term.endsWith("SP");
    const problems = [
      ...(credits > MAX_TERM_CREDITS ? [`Over ${MAX_TERM_CREDITS} credits needs approval`] : []),
      ...(regular && credits > 0 && credits < FULL_TIME_CREDITS ? [`Under ${FULL_TIME_CREDITS} credits is part-time`] : []),
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
  const sbcOpen = openSbc(result);

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
