/**
 * Degree audit: matches a student's coursework against program rule trees
 * (lib/domain/catalog/program.ts), SBC objectives, and university credit
 * rules. Pure and deterministic — no I/O, no UI concerns.
 *
 * Allocation is greedy in a fixed order: requirements without open choices
 * first, then "choose" requirements after any requirements they reference
 * (excludeUsedBy, notEquivalentTo). Within a program that disallows reuse,
 * each course is applied once. `anyOf` tries every alternative without
 * committing and keeps the one furthest along.
 */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type {
  ChoiceKind,
  ChooseConstraint,
  CourseSelector,
  ProgramDefinition,
  ProgramPolicy,
  ProgramRequirement,
  Rule,
  Substitution,
} from "@/lib/domain/catalog/program";
import type {
  CourseAttempt,
  CourseCode,
  CreditSource,
  Grade,
  LetterGrade,
  SbcCategory,
  SbcCode,
  StudentRecord,
} from "@/lib/domain/types";
import {
  isPassing,
  meetsMinGrade,
  standingFor,
  usableAttempts,
} from "./prerequisites";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RequirementStatus =
  | "satisfied"
  | "in-progress"
  | "partial"
  | "not-started"
  | "needs-review";

export interface AppliedCourse {
  code: CourseCode;
  credits: number;
  state: "completed" | "in-progress";
  source: CreditSource;
  grade?: Grade;
  /** Set when the course counts through a substitution. */
  viaSubstitution?: string;
}

/** What is still needed; the planner turns these into course suggestions. */
export type MissingItem =
  | { kind: "course"; options: CourseCode[] }
  | {
      kind: "choose";
      remaining: number;
      unit: "courses" | "credits";
      pool: CourseSelector;
      constraints: ChooseConstraint[];
      /** Courses that may not be used here (already used elsewhere, or equivalent). */
      exclude: CourseCode[];
      /**
       * The concentration (specialization, track) the pool belongs to: the one
       * declared, or else the closest, which the plan follows until one is.
       */
      option?: { kind: ChoiceKind; label: string; declared: boolean };
    }
  | { kind: "review"; text: string };

export interface RequirementResult {
  requirement: Pick<
    ProgramRequirement,
    "id" | "label" | "title" | "sourceText"
  >;
  programId: string;
  status: RequirementStatus;
  unit: "courses" | "credits";
  required: number;
  completed: number;
  inProgress: number;
  applied: AppliedCourse[];
  missing: MissingItem[];
  /** Policy problems, e.g. a grade below the minimum. */
  issues: string[];
  /** Conditions only an advisor can confirm. */
  manualChecks: string[];
  /** Explanations, e.g. which substitution changed this requirement. */
  notes: string[];
  /** The rule as evaluated: the catalog rule with any active substitution applied. */
  rule: Rule;
}

export type PolicyStatus =
  | "satisfied"
  | "in-progress"
  | "not-met"
  | "pending"
  | "info";

export interface PolicyResult {
  policy: ProgramPolicy;
  status: PolicyStatus;
  detail: string;
}

export interface ProgramAudit {
  program: ProgramDefinition;
  requirements: RequirementResult[];
  policies: PolicyResult[];
  satisfied: number;
  total: number;
  /** Completed courses rejected by a grade policy and not applied anywhere: retake candidates. */
  retakes: CourseCode[];
  /** Ids of substitutions in use (the student took or planned a replacement course). */
  activeSubstitutions: string[];
}

export interface SbcResult {
  category: SbcCategory;
  /** "not-required": the 4th upper-tier category once 3 of the 4 are met. */
  status: RequirementStatus | "exempt" | "not-required";
  appliedCode?: CourseCode;
  exemptReason?: string;
}

export interface SbcAudit {
  results: SbcResult[];
  satisfied: number;
  total: number;
}

export interface CreditSummary {
  required: number;
  earned: number;
  inProgress: number;
  bySource: Record<CreditSource, number>;
  upperDivision: { required: number; earned: number; inProgress: number };
  standing: "U1" | "U2" | "U3" | "U4";
}

export interface DegreeAudit {
  programs: ProgramAudit[];
  sbc: SbcAudit;
  credits: CreditSummary;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const GRADE_POINTS: Record<LetterGrade, number> = {
  A: 4,
  "A-": 3.67,
  "B+": 3.33,
  B: 3,
  "B-": 2.67,
  "C+": 2.33,
  C: 2,
  "C-": 1.67,
  "D+": 1.33,
  D: 1,
  F: 0,
};

function parseCode(code: CourseCode): { subject: string; number: number } {
  const [subject, number] = code.split(" ");
  return { subject, number: Number(number) };
}

/**
 * Credits a pool still takes of a course, given what already counts there:
 * "at most 6 credits from non-AMS courses" leaves 0 for a CSE course once two
 * CSE courses count. Infinity when no such limit covers the course.
 */
export function poolRoom(
  item: Extract<MissingItem, { kind: "choose" }>,
  applied: AppliedCourse[],
  catalog: Map<CourseCode, CourseRecord>,
  code: CourseCode,
): number {
  let room = Infinity;
  for (const k of item.constraints) {
    if (k.type !== "maxFrom" || !matchesSelector(code, catalog.get(code), k.from)) continue;
    const counted = applied.filter((a) => matchesSelector(a.code, catalog.get(a.code), k.from));
    if (k.maxCredits !== undefined) room = Math.min(room, k.maxCredits - counted.reduce((s, a) => s + a.credits, 0));
    if (k.maxCourses !== undefined) room = Math.min(room, (k.maxCourses - counted.length) * 3);
  }
  return Math.max(0, room);
}

export function matchesSelector(
  code: CourseCode,
  course: CourseRecord | undefined,
  sel: CourseSelector,
): boolean {
  const { subject, number } = parseCode(code);
  const listed =
    (sel.courses?.includes(code) ?? false) ||
    (sel.ranges?.some(
      (r) => r.subject === subject && number >= r.from && number <= r.to,
    ) ??
      false);
  const hasFilters =
    sel.subjects !== undefined ||
    sel.minNumber !== undefined ||
    sel.maxNumber !== undefined;
  const filtered =
    hasFilters &&
    (!sel.subjects || sel.subjects.includes(subject)) &&
    (sel.minNumber === undefined || number >= sel.minNumber) &&
    (sel.maxNumber === undefined || number <= sel.maxNumber);

  if (!listed && !filtered) return false;
  if (sel.excludeCourses?.includes(code)) return false;
  if (
    sel.minCredits !== undefined &&
    course &&
    course.credits.max < sel.minCredits
  )
    return false;
  if (sel.excludeAttributes?.some((a) => course?.attributes.includes(a)))
    return false;
  return true;
}

function statusFor(
  required: number,
  completed: number,
  inProgress: number,
): RequirementStatus {
  if (completed >= required) return "satisfied";
  if (completed + inProgress >= required) return "in-progress";
  if (completed + inProgress > 0) return "partial";
  return "not-started";
}

/** Best usable attempt per course: completed beats in-progress; higher grade beats lower. */
function bestAttempts(
  attempts: CourseAttempt[],
): Map<CourseCode, CourseAttempt> {
  const rank = (a: CourseAttempt) =>
    a.status === "in-progress"
      ? -1
      : a.grade && a.grade in GRADE_POINTS
        ? GRADE_POINTS[a.grade as LetterGrade]
        : 5;
  const best = new Map<CourseCode, CourseAttempt>();
  for (const attempt of usableAttempts(attempts)) {
    const current = best.get(attempt.code);
    if (!current || rank(attempt) > rank(current))
      best.set(attempt.code, attempt);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Program audit
// ---------------------------------------------------------------------------

interface Ctx {
  catalog: Map<CourseCode, CourseRecord>;
  attempts: Map<CourseCode, CourseAttempt>;
  allowReuse: boolean;
  used: Set<CourseCode>;
  /** Applied courses per requirement id and rule id. */
  appliedBy: Map<string, AppliedCourse[]>;
  /** Ids (requirement and enclosing rule ids) policies can target at this point of the walk. */
  scope: string[];
  policies: ProgramPolicy[];
  issues: { policyType: ProgramPolicy["type"]; message: string }[];
  rejected: Set<CourseCode>;
  /** The student's declared concentrations: choice rule id → chosen alternative id. */
  choices: Record<string, string>;
}

interface NodeResult {
  unit: "courses" | "credits";
  required: number;
  completed: number;
  inProgress: number;
  applied: AppliedCourse[];
  missing: MissingItem[];
  manualChecks: string[];
  needsReview: boolean;
}

function creditsOf(ctx: Ctx, attempt: CourseAttempt): number {
  return attempt.credits ?? ctx.catalog.get(attempt.code)?.credits.max ?? 0;
}

function toApplied(ctx: Ctx, attempt: CourseAttempt): AppliedCourse {
  const substitution = ctx.scope.find((id) =>
    id.startsWith(SUBSTITUTION_SCOPE),
  );
  return {
    code: attempt.code,
    credits: creditsOf(ctx, attempt),
    state: attempt.status,
    source: attempt.source,
    grade: attempt.grade,
    ...(substitution && {
      viaSubstitution: substitution.slice(SUBSTITUTION_SCOPE.length),
    }),
  };
}

/** Whether a completed attempt meets the grade policies in scope; records why not. */
function meetsGradePolicies(ctx: Ctx, attempt: CourseAttempt): boolean {
  if (attempt.status === "in-progress" || !attempt.grade) return true;
  for (const policy of ctx.policies) {
    if (
      !("appliesTo" in policy) ||
      !policy.appliesTo.some((id) => ctx.scope.includes(id))
    )
      continue;
    if (
      policy.type === "minGrade" &&
      !meetsMinGrade(attempt.grade, policy.grade)
    ) {
      ctx.issues.push({
        policyType: policy.type,
        message: `${attempt.code}: ${attempt.grade} is below the ${policy.grade} minimum`,
      });
      ctx.rejected.add(attempt.code);
      return false;
    }
    // Transfer/AP credit ("T") is not a pass/no-credit grade, so it is accepted here.
    if (
      policy.type === "letterGradeRequired" &&
      (attempt.grade === "P" || attempt.grade === "NC")
    ) {
      ctx.issues.push({
        policyType: policy.type,
        message: `${attempt.code}: must be taken for a letter grade`,
      });
      ctx.rejected.add(attempt.code);
      return false;
    }
  }
  return true;
}

function available(ctx: Ctx, code: CourseCode): CourseAttempt | undefined {
  if (!ctx.allowReuse && ctx.used.has(code)) return undefined;
  const attempt = ctx.attempts.get(code);
  return attempt && meetsGradePolicies(ctx, attempt) ? attempt : undefined;
}

function claim(ctx: Ctx, attempt: CourseAttempt, applied: AppliedCourse) {
  ctx.used.add(attempt.code);
  for (const id of ctx.scope)
    ctx.appliedBy.set(id, [...(ctx.appliedBy.get(id) ?? []), applied]);
}

function emptyResult(unit: NodeResult["unit"] = "courses"): NodeResult {
  return {
    unit,
    required: 0,
    completed: 0,
    inProgress: 0,
    applied: [],
    missing: [],
    manualChecks: [],
    needsReview: false,
  };
}

function forkCtx(ctx: Ctx): Ctx {
  return {
    ...ctx,
    used: new Set(ctx.used),
    appliedBy: new Map(ctx.appliedBy),
    issues: [],
    rejected: new Set(ctx.rejected),
  };
}

function evaluateRule(ctx: Ctx, rule: Rule): NodeResult {
  const scoped = rule.id ? { ...ctx, scope: [...ctx.scope, rule.id] } : ctx;
  const result = evaluateNode(scoped, rule);
  if (rule.manualCheck) result.manualChecks.push(rule.manualCheck);
  return result;
}

function evaluateNode(ctx: Ctx, rule: Rule): NodeResult {
  switch (rule.type) {
    case "course": {
      const result = { ...emptyResult(), required: 1 };
      const attempt = available(ctx, rule.code);
      if (!attempt)
        return {
          ...result,
          missing: [{ kind: "course", options: [rule.code] }],
        };
      const applied = toApplied(ctx, attempt);
      claim(ctx, attempt, applied);
      return {
        ...result,
        applied: [applied],
        completed: attempt.status === "completed" ? 1 : 0,
        inProgress: attempt.status === "in-progress" ? 1 : 0,
      };
    }

    case "allOf": {
      const result = emptyResult();
      for (const child of rule.rules) {
        const r = evaluateRule(ctx, child);
        result.required += r.required;
        result.completed += r.completed;
        result.inProgress += r.inProgress;
        result.applied.push(...r.applied);
        result.missing.push(...r.missing);
        result.manualChecks.push(...r.manualChecks);
        result.needsReview ||= r.needsReview;
      }
      return result;
    }

    case "anyOf": {
      // A declared concentration (or specialization, track) is the only alternative that counts.
      const chosen = rule.choice && rule.id ? rule.rules.find((alt) => alt.id === ctx.choices[rule.id!]) : undefined;
      /** Marks the pools still open in a concentration with which one it is. */
      const tag = (r: NodeResult, alt: Rule, declared: boolean): NodeResult =>
        rule.choice && alt.label
          ? { ...r, missing: r.missing.map((m) => (m.kind === "choose" ? { ...m, option: { kind: rule.choice!, label: alt.label!, declared } } : m)) }
          : r;
      if (chosen) return tag(evaluateRule(ctx, chosen), chosen, true);
      // Otherwise score each alternative on a throwaway context, then commit the best.
      const scores = rule.rules.map((alt) => {
        const r = evaluateRule(forkCtx(ctx), alt);
        return r.required === 0
          ? 0
          : (r.completed + 0.99 * r.inProgress) / r.required;
      });
      const bestScore = Math.max(...scores);
      // With nothing started, report the first alternative the catalog can satisfy, not one naming missing courses.
      const inCatalog = (alt: Rule): boolean =>
        alt.type === "course" ? ctx.catalog.has(alt.code) : alt.type === "allOf" || alt.type === "anyOf" ? alt.rules.every(inCatalog) : alt.type !== "unparsed";
      const first =
        (bestScore === 0 ? rule.rules.find((alt, i) => scores[i] === 0 && inCatalog(alt)) : undefined) ??
        rule.rules[scores.indexOf(bestScore)];
      // Alternatives equally far along: the one with the most courses the student prefers.
      const liked = (alt: Rule) => mandatoryCourses(alt).filter((c) => preferredCourses(ctx.choices).has(c)).length;
      const tied = rule.rules.filter((alt, i) => scores[i] === bestScore && (bestScore > 0 || inCatalog(alt)));
      const best = tied.length > 1 ? tied.reduce((a, b) => (liked(b) > liked(a) ? b : a), first) : first;
      const result = evaluateRule(ctx, best);
      // Nothing started and every alternative is a single course: offer them all as one slot.
      if (bestScore === 0 && rule.rules.every((alt) => alt.type === "course")) {
        const options = rule.rules.map((alt) =>
          alt.type === "course" ? alt.code : "",
        );
        return { ...result, missing: [{ kind: "course", options }] };
      }
      return tag(result, best, false);
    }

    case "choose":
      return evaluateChoose(ctx, rule);

    case "unparsed":
      return {
        ...emptyResult(),
        required: 1,
        missing: [{ kind: "review", text: rule.text }],
        needsReview: true,
      };
  }
}

function evaluateChoose(
  ctx: Ctx,
  rule: Extract<Rule, { type: "choose" }>,
): NodeResult {
  const unit = rule.count !== undefined ? "courses" : "credits";
  const required = rule.count ?? rule.credits ?? 0;
  const constraints = rule.constraints ?? [];

  // Courses that may not be used here.
  const exclude = new Set<CourseCode>();
  for (const id of rule.from.excludeUsedBy ?? [])
    ctx.appliedBy.get(id)?.forEach((a) => exclude.add(a.code));
  for (const k of constraints) {
    if (k.type !== "notEquivalentTo") continue;
    for (const a of ctx.appliedBy.get(k.requirementId) ?? []) {
      exclude.add(a.code);
      ctx.catalog.get(a.code)?.equivalents.forEach((e) => exclude.add(e));
      // Equivalence may be recorded on either course.
      for (const course of ctx.catalog.values())
        if (course.equivalents.includes(a.code)) exclude.add(course.code);
    }
  }

  const minFrom = constraints.filter(
    (k): k is Extract<ChooseConstraint, { type: "minFrom" }> =>
      k.type === "minFrom",
  );
  const eligible = [...ctx.attempts.values()]
    .filter(
      (a) => !exclude.has(a.code) && (ctx.allowReuse || !ctx.used.has(a.code)),
    )
    .filter((a) => matchesSelector(a.code, ctx.catalog.get(a.code), rule.from))
    .sort((a, b) => {
      // Courses that satisfy a minimum-from constraint first, then completed before in-progress.
      const inMin = (x: CourseAttempt) =>
        minFrom.some((k) =>
          matchesSelector(x.code, ctx.catalog.get(x.code), k.from),
        )
          ? 0
          : 1;
      return (
        inMin(a) - inMin(b) ||
        Number(a.status === "in-progress") - Number(b.status === "in-progress")
      );
    });

  // Each "at least N from …" group gets its courses first, so an early pick from one group can't crowd out another.
  const firsts: CourseAttempt[] = [];
  for (const k of minFrom) {
    const countedElsewhere = (k.countUsedBy ?? [])
      .flatMap((id) => ctx.appliedBy.get(id) ?? [])
      .filter((a) => matchesSelector(a.code, ctx.catalog.get(a.code), k.from)).length;
    const alreadyFirst = firsts.filter((a) => matchesSelector(a.code, ctx.catalog.get(a.code), k.from)).length;
    eligible
      .filter((a) => !firsts.includes(a) && matchesSelector(a.code, ctx.catalog.get(a.code), k.from))
      .slice(0, Math.max(0, k.minCourses - countedElsewhere - alreadyFirst))
      .forEach((a) => firsts.push(a));
  }
  const candidates = [...firsts, ...eligible.filter((a) => !firsts.includes(a))];

  const result: NodeResult = { ...emptyResult(unit), required };
  const capUsage = new Map<
    ChooseConstraint,
    { courses: number; credits: number }
  >();
  const groupsUsed = new Set<number>();
  const measure = () =>
    unit === "courses"
      ? result.applied.length
      : result.applied.reduce((s, a) => s + a.credits, 0);

  for (const attempt of candidates) {
    if (measure() >= required) break;
    if (!meetsGradePolicies(ctx, attempt)) continue;
    const credits = creditsOf(ctx, attempt);

    const caps = constraints.filter(
      (k): k is Extract<ChooseConstraint, { type: "maxFrom" }> =>
        k.type === "maxFrom" &&
        matchesSelector(attempt.code, ctx.catalog.get(attempt.code), k.from),
    );
    const overCap = caps.some((k) => {
      const usage = capUsage.get(k) ?? { courses: 0, credits: 0 };
      return (
        (k.maxCourses !== undefined && usage.courses + 1 > k.maxCourses) ||
        (k.maxCredits !== undefined && usage.credits + credits > k.maxCredits)
      );
    });
    if (overCap) continue;

    const groupIndexes = constraints.flatMap((k) =>
      k.type === "onePerGroup"
        ? k.groups
            .map((g, i) => (g.includes(attempt.code) ? i : -1))
            .filter((i) => i >= 0)
        : [],
    );
    if (groupIndexes.some((i) => groupsUsed.has(i))) continue;

    const applied = toApplied(ctx, attempt);
    claim(ctx, attempt, applied);
    result.applied.push(applied);
    caps.forEach((k) => {
      const usage = capUsage.get(k) ?? { courses: 0, credits: 0 };
      capUsage.set(k, {
        courses: usage.courses + 1,
        credits: usage.credits + credits,
      });
    });
    groupIndexes.forEach((i) => groupsUsed.add(i));
  }

  const amount = (a: AppliedCourse) => (unit === "courses" ? 1 : a.credits);
  result.completed = result.applied
    .filter((a) => a.state === "completed")
    .reduce((s, a) => s + amount(a), 0);
  result.inProgress = result.applied
    .filter((a) => a.state === "in-progress")
    .reduce((s, a) => s + amount(a), 0);

  // A minimum-from shortfall keeps the requirement open even when the count is reached.
  let shortfall = 0;
  for (const k of minFrom) {
    const counted = [
      ...result.applied,
      ...(k.countUsedBy ?? []).flatMap((id) => ctx.appliedBy.get(id) ?? []),
    ];
    const have = counted.filter((a) =>
      matchesSelector(a.code, ctx.catalog.get(a.code), k.from),
    ).length;
    if (have < k.minCourses) {
      const deficit = Math.min(k.minCourses - have, required);
      shortfall = Math.max(shortfall, deficit);
      result.completed = Math.min(result.completed, required - deficit);
      result.inProgress = Math.min(
        result.inProgress,
        required - deficit - result.completed,
      );
      result.missing.push({
        kind: "choose",
        remaining: deficit,
        unit: "courses",
        pool: k.from,
        constraints: [],
        exclude: [...exclude],
      });
    }
  }

  // Courses that make up the shortfall also count toward the total, so they aren't asked for twice.
  const remaining = required - result.completed - result.inProgress - shortfall;
  if (remaining > 0) {
    result.missing.push({
      kind: "choose",
      remaining,
      unit,
      pool: rule.from,
      constraints,
      exclude: [...exclude],
    });
  }
  return result;
}

function containsChoose(rule: Rule): boolean {
  if (rule.type === "choose") return true;
  return (
    (rule.type === "allOf" || rule.type === "anyOf") &&
    rule.rules.some(containsChoose)
  );
}

/** Requirement ids referenced by a requirement's choose rules. */
function dependencies(rule: Rule, ruleOwner: Map<string, string>): string[] {
  if (rule.type === "allOf" || rule.type === "anyOf")
    return rule.rules.flatMap((r) => dependencies(r, ruleOwner));
  if (rule.type !== "choose") return [];
  const ids = [
    ...(rule.from.excludeUsedBy ?? []),
    ...(rule.constraints ?? []).flatMap((k) =>
      k.type === "notEquivalentTo"
        ? [k.requirementId]
        : k.type === "minFrom"
          ? (k.countUsedBy ?? [])
          : [],
    ),
  ];
  return ids.map((id) => ruleOwner.get(id) ?? id);
}

function collectRuleIds(rule: Rule, owner: string, into: Map<string, string>) {
  if (rule.id) into.set(rule.id, owner);
  if (rule.type === "allOf" || rule.type === "anyOf")
    rule.rules.forEach((r) => collectRuleIds(r, owner, into));
}

/** Fixed requirements first, then choose requirements after the ones they reference. */
function evaluationOrder(
  requirements: ProgramRequirement[],
): ProgramRequirement[] {
  const owner = new Map<string, string>();
  requirements.forEach((req) => {
    owner.set(req.id, req.id);
    collectRuleIds(req.rule, req.id, owner);
  });
  const pending = [...requirements].sort(
    (a, b) => Number(containsChoose(a.rule)) - Number(containsChoose(b.rule)),
  );
  const done = new Set<string>();
  const order: ProgramRequirement[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((req) =>
      dependencies(req.rule, owner).every((d) => done.has(d) || d === req.id),
    );
    // A dependency cycle shouldn't happen; fall back to the next requirement rather than looping.
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    order.push(next);
    done.add(next.id);
  }
  return order;
}

const SUBSTITUTION_SCOPE = "substitution:";

const PREFER_PREFIX = "prefer:";

/** Courses the student has chosen over the alternatives that would do (stored with their choices as "prefer:<code>"). */
export function preferredCourses(choices: Record<string, string> | undefined): Set<CourseCode> {
  return new Set(Object.keys(choices ?? {}).filter((k) => k.startsWith(PREFER_PREFIX)).map((k) => k.slice(PREFER_PREFIX.length)));
}

/** Courses the student has picked for a "choose" seat, or taken off their list ("pick:<code>", "avoid:<code>" in choices). */
export function pickedCourses(choices: Record<string, string> | undefined, kind: "pick" | "avoid"): Set<CourseCode> {
  const prefix = `${kind}:`;
  return new Set(Object.keys(choices ?? {}).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

/** Course codes a rule requires outright: every course leaf not under an anyOf or choose. */
export function mandatoryCourses(rule: Rule): CourseCode[] {
  if (rule.type === "course") return [rule.code];
  if (rule.type === "allOf") return rule.rules.flatMap(mandatoryCourses);
  return [];
}

/** The courses a substitution puts in place, when it is a plain course or list of courses. */
export function substitutionCourses(sub: Substitution): CourseCode[] {
  if (sub.with.type === "course") return [sub.with.code];
  if (sub.with.type === "allOf" && sub.with.rules.every((r) => r.type === "course")) {
    return sub.with.rules.flatMap((r) => (r.type === "course" ? [r.code] : []));
  }
  return [];
}

/**
 * Whether a substitution may apply without an advisor. One with an eligibility
 * condition ("Students pursuing Honors") counts only when another of the
 * student's programs requires its courses, e.g. the Honors CS program
 * requiring CSE 350. Ones needing approval, or replacing a rule rather than
 * courses, never apply automatically.
 */
export function substitutionEligible(sub: Substitution, requiredElsewhere: Set<CourseCode>): boolean {
  if (sub.requiresApproval || sub.replaces.type !== "courses") return false;
  const codes = substitutionCourses(sub);
  return codes.length > 0 && (!sub.condition || codes.every((c) => requiredElsewhere.has(c)));
}

/**
 * An eligible substitution is in use once the student has taken, is taking,
 * or has planned any of its courses (adding CSE 160 to the plan selects the
 * honors sequence), or when another of their programs requires all of them
 * (an honors program that requires the honors sequence).
 */
function activeSubstitutions(
  program: ProgramDefinition,
  attempts: Map<CourseCode, CourseAttempt>,
  planned: Set<CourseCode>,
  requiredElsewhere: Set<CourseCode>,
): Substitution[] {
  return program.substitutions.filter((sub) => {
    if (!substitutionEligible(sub, requiredElsewhere)) return false;
    const codes = substitutionCourses(sub);
    return codes.some((code) => attempts.has(code) || planned.has(code)) || codes.every((code) => requiredElsewhere.has(code));
  });
}

interface SubstitutionState {
  sub: Substitution;
  replaced: CourseCode[];
  requirementId: string;
  placedIn?: { id: string; label: string };
  covered: Map<string, CourseCode[]>;
}

/**
 * Rewrites a rule for an active substitution. The first replaced course (in
 * requirement order) becomes the replacement rule, so its progress and missing
 * courses show up there; later replaced courses are covered and drop out.
 * Returns null for a node the substitution fully covers.
 */
function substituteRule(rule: Rule, state: SubstitutionState): Rule | null {
  switch (rule.type) {
    case "course":
      if (!state.replaced.includes(rule.code)) return rule;
      if (!state.placedIn) {
        state.placedIn = { id: state.requirementId, label: "" };
        return {
          ...state.sub.with,
          id: `${SUBSTITUTION_SCOPE}${state.sub.id}`,
          ...(state.sub.condition && { manualCheck: state.sub.condition }),
        };
      }
      // Replaced courses in the same requirement as the replacement need no separate note.
      if (state.requirementId !== state.placedIn.id) {
        state.covered.set(state.requirementId, [
          ...(state.covered.get(state.requirementId) ?? []),
          rule.code,
        ]);
      }
      return null;
    case "allOf":
      return {
        ...rule,
        rules: rule.rules
          .map((r) => substituteRule(r, state))
          .filter((r): r is Rule => r !== null),
      };
    case "anyOf": {
      const rules = rule.rules.map((r) => substituteRule(r, state));
      // A covered alternative satisfies the whole choice.
      return rules.includes(null) ? null : { ...rule, rules: rules as Rule[] };
    }
    default:
      return rule;
  }
}

export interface SubstitutionLayout {
  sub: Substitution;
  /** Course codes that make up the replacement. */
  replacement: CourseCode[];
  /** Course codes it replaces. */
  replaced: CourseCode[];
  /** Where the replacement is evaluated: the requirement holding the first replaced course. */
  placedIn: { id: string; label: string };
  /** Replaced courses in other requirements than placedIn, by requirement id. */
  covered: Map<string, CourseCode[]>;
}

/** Rewrites requirements for one substitution and reports where it landed. */
function layoutSubstitution(
  requirements: ProgramRequirement[],
  sub: Substitution,
): { requirements: ProgramRequirement[]; layout: SubstitutionLayout | null } {
  if (sub.replaces.type !== "courses") return { requirements, layout: null };
  const state: SubstitutionState = {
    sub,
    replaced: sub.replaces.courses,
    requirementId: "",
    covered: new Map(),
  };
  const rewritten = requirements.map((req) => {
    state.requirementId = req.id;
    const hadPlaced = Boolean(state.placedIn);
    const rule = substituteRule(req.rule, state) ?? {
      type: "allOf" as const,
      rules: [],
    };
    if (!hadPlaced && state.placedIn) state.placedIn.label = req.label;
    return { ...req, rule };
  });
  if (!state.placedIn) return { requirements, layout: null };
  return {
    requirements: rewritten,
    layout: {
      sub,
      replacement: substitutionCourses(sub),
      replaced: state.replaced,
      placedIn: state.placedIn,
      covered: state.covered,
    },
  };
}

/**
 * Where each course substitution in a program would apply, whether or not a
 * student uses it. The Degree Explorer shows alternatives with this, so it
 * matches how the audit applies them.
 */
export function substitutionLayouts(
  program: ProgramDefinition,
): SubstitutionLayout[] {
  return program.substitutions.flatMap((sub) => {
    const { layout } = layoutSubstitution(program.requirements, sub);
    return layout && layout.replacement.length > 0 ? [layout] : [];
  });
}

/** Applies active substitutions to the requirement rules and explains each change. */
function applySubstitutions(
  requirements: ProgramRequirement[],
  substitutions: Substitution[],
): { requirements: ProgramRequirement[]; notes: Map<string, string[]> } {
  const notes = new Map<string, string[]>();
  const note = (id: string, text: string) =>
    notes.set(id, [...(notes.get(id) ?? []), text]);
  for (const sub of substitutions) {
    const result = layoutSubstitution(requirements, sub);
    if (!result.layout) continue;
    requirements = result.requirements;
    const { placedIn, covered, replacement, replaced } = result.layout;
    const codes = replacement.join(", ");
    note(
      placedIn.id,
      `Substitution in use: ${codes} replace ${replaced.join(", ")}.`,
    );
    for (const [id, codesCovered] of covered) {
      note(
        id,
        `${codesCovered.join(", ")} ${codesCovered.length === 1 ? "is" : "are"} covered by ${codes} (requirement ${placedIn.label}).`,
      );
    }
  }
  return { requirements, notes };
}

function evaluatePolicies(
  ctx: Ctx,
  program: ProgramDefinition,
  rejectedBy: Map<string, Ctx["issues"]>,
): PolicyResult[] {
  const appliedTo = (ids: string[]) => {
    const seen = new Set<string>();
    return ids
      .flatMap((id) => ctx.appliedBy.get(id) ?? [])
      .filter((a) => !seen.has(a.code) && seen.add(a.code));
  };

  return program.policies.map((policy): PolicyResult => {
    switch (policy.type) {
      case "minGrade":
      case "letterGradeRequired": {
        const problems = [
          ...new Set(
            policy.appliesTo
              .flatMap((id) => rejectedBy.get(id) ?? [])
              .filter((issue) => issue.policyType === policy.type)
              .map((issue) => issue.message),
          ),
        ];
        return problems.length > 0
          ? { policy, status: "not-met", detail: problems.join("; ") }
          : { policy, status: "satisfied", detail: "" };
      }
      case "minGpa": {
        // Transfer and exam grades don't enter the Stony Brook GPA.
        const graded = appliedTo(policy.appliesTo).filter(
          (a) =>
            a.state === "completed" &&
            a.source === "sbu" &&
            a.grade &&
            a.grade in GRADE_POINTS,
        );
        if (graded.length === 0)
          return { policy, status: "pending", detail: "" };
        const credits = graded.reduce((s, a) => s + a.credits, 0);
        const gpa =
          graded.reduce(
            (s, a) => s + GRADE_POINTS[a.grade as LetterGrade] * a.credits,
            0,
          ) / credits;
        return {
          policy,
          status: gpa >= policy.gpa ? "satisfied" : "not-met",
          detail: `${gpa.toFixed(2)} / ${policy.gpa.toFixed(2)} minimum`,
        };
      }
      case "residencyCredits": {
        const applied = appliedTo(policy.appliesTo).filter(
          (a) => a.source === "sbu",
        );
        const done = applied
          .filter((a) => a.state === "completed")
          .reduce((s, a) => s + a.credits, 0);
        const pending = applied
          .filter((a) => a.state === "in-progress")
          .reduce((s, a) => s + a.credits, 0);
        return {
          policy,
          status:
            done >= policy.minCredits
              ? "satisfied"
              : done + pending >= policy.minCredits
                ? "in-progress"
                : "not-met",
          detail: `${done}${pending ? ` + ${pending}` : ""} / ${policy.minCredits} credits`,
        };
      }
      case "residencyRequired": {
        const applied = appliedTo(policy.appliesTo);
        if (applied.length === 0)
          return { policy, status: "pending", detail: "" };
        const outside = applied.filter((a) => a.source !== "sbu");
        return outside.length > 0
          ? {
              policy,
              status: "not-met",
              detail: `${outside.map((a) => a.code).join(", ")} must be taken at Stony Brook`,
            }
          : { policy, status: "satisfied", detail: "" };
      }
      case "prerequisiteGrade":
        return {
          policy,
          status: "info",
          detail: `${policy.minGrade} or higher in ${policy.subjects.join(", ")} prerequisites`,
        };
    }
  });
}

export function auditProgram(
  program: ProgramDefinition,
  student: StudentRecord,
  catalog: Map<CourseCode, CourseRecord>,
  /** Courses the student's other programs require outright. */
  requiredElsewhere: Set<CourseCode> = new Set(),
): ProgramAudit {
  const attempts = bestAttempts(student.attempts);
  const planned = new Set(
    student.plan.flatMap((t) =>
      t.items.flatMap((i) => ("code" in i ? [i.code] : [])),
    ),
  );
  const active = activeSubstitutions(program, attempts, planned, requiredElsewhere);
  const { requirements: rules, notes } = applySubstitutions(
    program.requirements,
    active,
  );

  const ctx: Ctx = {
    catalog,
    attempts,
    allowReuse: program.allowCourseReuse,
    used: new Set(),
    appliedBy: new Map(),
    scope: [],
    policies: program.policies,
    issues: [],
    rejected: new Set(),
    choices: student.choices ?? {},
  };

  const byId = new Map<string, RequirementResult>();
  const rejectedBy = new Map<string, Ctx["issues"]>();
  for (const req of evaluationOrder(rules)) {
    const reqCtx: Ctx = { ...ctx, scope: [req.id], issues: [] };
    const r = evaluateRule(reqCtx, req.rule);
    rejectedBy.set(req.id, reqCtx.issues);
    const issues = [...new Set(reqCtx.issues.map((i) => i.message))];
    byId.set(req.id, {
      requirement: {
        id: req.id,
        label: req.label,
        title: req.title,
        sourceText: req.sourceText,
      },
      programId: program.id,
      status:
        r.needsReview && r.completed + r.inProgress < r.required
          ? "needs-review"
          : statusFor(r.required, r.completed, r.inProgress),
      unit: r.unit,
      required: r.required,
      completed: r.completed,
      inProgress: r.inProgress,
      applied: r.applied,
      missing: r.missing,
      issues,
      manualChecks: r.manualChecks,
      notes: notes.get(req.id) ?? [],
      rule: req.rule,
    });
  }

  const requirements = program.requirements.map((req) => byId.get(req.id)!);
  const appliedCodes = new Set(
    requirements.flatMap((r) => r.applied.map((a) => a.code)),
  );
  return {
    program,
    requirements,
    policies: evaluatePolicies(ctx, program, rejectedBy),
    satisfied: requirements.filter((r) => r.status === "satisfied").length,
    total: requirements.length,
    retakes: [...ctx.rejected].filter((code) => !appliedCodes.has(code)),
    activeSubstitutions: active.map((sub) => sub.id),
  };
}

// ---------------------------------------------------------------------------
// SBC and credits
// ---------------------------------------------------------------------------

/**
 * "Pursue Deeper Understanding by completing advanced studies in three of four
 * distinct areas of knowledge" (Undergraduate Catalog, The Stony Brook Curriculum).
 */
export const DEEPER_UNDERSTANDING = {
  categories: ["EXP+", "HFA+", "SBS+", "STEM+"] as SbcCode[],
  required: 3,
};

/** Splits SBC results into the individually required objectives and the "three of" upper-tier group. */
export function groupSbcResults(results: SbcResult[]): {
  required: SbcResult[];
  threeOf: SbcResult[];
} {
  const inGroup = (r: SbcResult) =>
    DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  return {
    required: results.filter((r) => !inGroup(r)),
    threeOf: results.filter(inGroup),
  };
}

export function auditSbc(
  student: StudentRecord,
  catalog: Map<CourseCode, CourseRecord>,
  categories: SbcCategory[],
  programs: ProgramDefinition[],
): SbcAudit {
  const attempts = [...bestAttempts(student.attempts).values()].sort(
    (a, b) =>
      Number(a.status === "in-progress") - Number(b.status === "in-progress"),
  );
  const exemptions = new Map<SbcCode, string>(
    programs.flatMap((p) =>
      p.sbc.exemptions.map((e) => [e.category, e.reason]),
    ),
  );

  const results = categories.map((category): SbcResult => {
    const exemptReason = exemptions.get(category.code);
    if (exemptReason) return { category, status: "exempt", exemptReason };
    // Transcript-printed tags count too; partial-fulfillment tags don't satisfy a category alone.
    const match = attempts.find(
      (a) =>
        a.sbc?.includes(category.code) ||
        catalog
          .get(a.code)
          ?.sbc.some((tag) => tag.category === category.code && !tag.partial),
    );
    if (!match) return { category, status: "not-started" };
    return {
      category,
      status: match.status === "completed" ? "satisfied" : "in-progress",
      appliedCode: match.code,
    };
  });

  // Only three of the four upper-tier categories are required. Once three are met,
  // the fourth isn't needed; it counts toward neither the total nor the satisfied count.
  const met = (r: SbcResult) =>
    r.status === "satisfied" || r.status === "exempt";
  const isDeeper = (r: SbcResult) =>
    DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeper = results.filter(isDeeper);
  if (deeper.filter(met).length >= DEEPER_UNDERSTANDING.required) {
    for (const r of deeper) {
      if (met(r) || r.status === "in-progress") continue;
      r.status = "not-required";
    }
  }
  const optional =
    deeper.length - Math.min(deeper.length, DEEPER_UNDERSTANDING.required);

  return {
    results,
    satisfied:
      results.filter((r) => !isDeeper(r) && met(r)).length +
      Math.min(deeper.filter(met).length, DEEPER_UNDERSTANDING.required),
    total: results.length - optional,
  };
}

export function summarizeCredits(
  student: StudentRecord,
  catalog: Map<CourseCode, CourseRecord>,
  rules: {
    totalCredits: number;
    upperDivisionCredits: number;
    upperDivisionMinNumber: number;
  },
): CreditSummary {
  const bySource: Record<CreditSource, number> = { sbu: 0, transfer: 0, ap: 0 };
  const upperDivision = {
    required: rules.upperDivisionCredits,
    earned: 0,
    inProgress: 0,
  };
  let earned = 0;
  let inProgress = 0;

  for (const attempt of bestAttempts(student.attempts).values()) {
    const credits =
      attempt.credits ?? catalog.get(attempt.code)?.credits.max ?? 0;
    const upper =
      parseCode(attempt.code).number >= rules.upperDivisionMinNumber;
    if (attempt.status === "in-progress") {
      inProgress += credits;
      if (upper) upperDivision.inProgress += credits;
    } else if (attempt.grade && isPassing(attempt.grade)) {
      earned += credits;
      bySource[attempt.source] += credits;
      if (upper) upperDivision.earned += credits;
    }
  }

  return {
    required: rules.totalCredits,
    earned,
    inProgress,
    bySource,
    upperDivision,
    standing: standingFor(earned),
  };
}

/** Courses that the other enrolled programs require outright. */
export function requiredByOthers(
  program: ProgramDefinition,
  enrolled: ProgramDefinition[],
): Set<CourseCode> {
  return new Set(
    enrolled
      .filter((p) => p !== program)
      .flatMap((p) => p.requirements.flatMap((r) => mandatoryCourses(r.rule))),
  );
}

export function runDegreeAudit({
  student,
  programs,
  courses,
  sbcCategories,
  creditRules,
}: {
  student: StudentRecord;
  programs: ProgramDefinition[];
  courses: CourseRecord[];
  sbcCategories: SbcCategory[];
  creditRules: Parameters<typeof summarizeCredits>[2];
}): DegreeAudit {
  const catalog = new Map(courses.map((c) => [c.code, c]));
  const enrolled = programs.filter((p) => student.programIds.includes(p.id));
  return {
    programs: enrolled.map((p) =>
      auditProgram(p, student, catalog, requiredByOthers(p, enrolled)),
    ),
    sbc: auditSbc(student, catalog, sbcCategories, enrolled),
    credits: summarizeCredits(student, catalog, creditRules),
  };
}
