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
  ChooseConstraint,
  CourseSelector,
  ProgramDefinition,
  ProgramPolicy,
  ProgramRequirement,
  Rule,
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
import { isPassing, meetsMinGrade, standingFor, usableAttempts } from "./prerequisites";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RequirementStatus = "satisfied" | "in-progress" | "partial" | "not-started" | "needs-review";

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
    }
  | { kind: "review"; text: string };

export interface RequirementResult {
  requirement: Pick<ProgramRequirement, "id" | "label" | "title" | "sourceText">;
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
}

export type PolicyStatus = "satisfied" | "in-progress" | "not-met" | "pending" | "info";

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
}

export interface SbcResult {
  category: SbcCategory;
  status: RequirementStatus | "exempt";
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

const GRADE_POINTS: Record<LetterGrade, number> = {
  A: 4, "A-": 3.67, "B+": 3.33, B: 3, "B-": 2.67, "C+": 2.33, C: 2, "C-": 1.67, "D+": 1.33, D: 1, F: 0,
};

function parseCode(code: CourseCode): { subject: string; number: number } {
  const [subject, number] = code.split(" ");
  return { subject, number: Number(number) };
}

export function matchesSelector(code: CourseCode, course: CourseRecord | undefined, sel: CourseSelector): boolean {
  const { subject, number } = parseCode(code);
  const listed =
    (sel.courses?.includes(code) ?? false) ||
    (sel.ranges?.some((r) => r.subject === subject && number >= r.from && number <= r.to) ?? false);
  const hasFilters =
    sel.subjects !== undefined || sel.minNumber !== undefined || sel.maxNumber !== undefined;
  const filtered =
    hasFilters &&
    (!sel.subjects || sel.subjects.includes(subject)) &&
    (sel.minNumber === undefined || number >= sel.minNumber) &&
    (sel.maxNumber === undefined || number <= sel.maxNumber);

  if (!listed && !filtered) return false;
  if (sel.excludeCourses?.includes(code)) return false;
  if (sel.minCredits !== undefined && course && course.credits.max < sel.minCredits) return false;
  if (sel.excludeAttributes?.some((a) => course?.attributes.includes(a))) return false;
  return true;
}

function statusFor(required: number, completed: number, inProgress: number): RequirementStatus {
  if (completed >= required) return "satisfied";
  if (completed + inProgress >= required) return "in-progress";
  if (completed + inProgress > 0) return "partial";
  return "not-started";
}

/** Best usable attempt per course: completed beats in-progress; higher grade beats lower. */
function bestAttempts(attempts: CourseAttempt[]): Map<CourseCode, CourseAttempt> {
  const rank = (a: CourseAttempt) =>
    a.status === "in-progress" ? -1 : a.grade && a.grade in GRADE_POINTS ? GRADE_POINTS[a.grade as LetterGrade] : 5;
  const best = new Map<CourseCode, CourseAttempt>();
  for (const attempt of usableAttempts(attempts)) {
    const current = best.get(attempt.code);
    if (!current || rank(attempt) > rank(current)) best.set(attempt.code, attempt);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Program audit
// ---------------------------------------------------------------------------

interface Attempt extends CourseAttempt {
  viaSubstitution?: string;
}

interface Ctx {
  catalog: Map<CourseCode, CourseRecord>;
  attempts: Map<CourseCode, Attempt>;
  allowReuse: boolean;
  used: Set<CourseCode>;
  /** Applied courses per requirement id and rule id. */
  appliedBy: Map<string, AppliedCourse[]>;
  /** Ids (requirement and enclosing rule ids) policies can target at this point of the walk. */
  scope: string[];
  policies: ProgramPolicy[];
  issues: { policyType: ProgramPolicy["type"]; message: string }[];
  rejected: Set<CourseCode>;
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

function toApplied(ctx: Ctx, attempt: Attempt): AppliedCourse {
  return {
    code: attempt.code,
    credits: creditsOf(ctx, attempt),
    state: attempt.status,
    source: attempt.source,
    grade: attempt.grade,
    viaSubstitution: attempt.viaSubstitution,
  };
}

/** Whether a completed attempt meets the grade policies in scope; records why not. */
function meetsGradePolicies(ctx: Ctx, attempt: Attempt): boolean {
  if (attempt.status === "in-progress" || !attempt.grade || attempt.viaSubstitution) return true;
  for (const policy of ctx.policies) {
    if (!("appliesTo" in policy) || !policy.appliesTo.some((id) => ctx.scope.includes(id))) continue;
    if (policy.type === "minGrade" && !meetsMinGrade(attempt.grade, policy.grade)) {
      ctx.issues.push({ policyType: policy.type, message: `${attempt.code}: ${attempt.grade} is below the ${policy.grade} minimum` });
      ctx.rejected.add(attempt.code);
      return false;
    }
    // Transfer/AP credit ("T") is not a pass/no-credit grade, so it is accepted here.
    if (policy.type === "letterGradeRequired" && (attempt.grade === "P" || attempt.grade === "NC")) {
      ctx.issues.push({ policyType: policy.type, message: `${attempt.code}: must be taken for a letter grade` });
      ctx.rejected.add(attempt.code);
      return false;
    }
  }
  return true;
}

function available(ctx: Ctx, code: CourseCode): Attempt | undefined {
  if (!ctx.allowReuse && ctx.used.has(code)) return undefined;
  const attempt = ctx.attempts.get(code);
  return attempt && meetsGradePolicies(ctx, attempt) ? attempt : undefined;
}

function claim(ctx: Ctx, attempt: Attempt, applied: AppliedCourse) {
  ctx.used.add(attempt.code);
  for (const id of ctx.scope) ctx.appliedBy.set(id, [...(ctx.appliedBy.get(id) ?? []), applied]);
}

function emptyResult(unit: NodeResult["unit"] = "courses"): NodeResult {
  return { unit, required: 0, completed: 0, inProgress: 0, applied: [], missing: [], manualChecks: [], needsReview: false };
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
      if (!attempt) return { ...result, missing: [{ kind: "course", options: [rule.code] }] };
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
      // Score each alternative on a throwaway context, then commit the best.
      const scores = rule.rules.map((alt) => {
        const r = evaluateRule(forkCtx(ctx), alt);
        return r.required === 0 ? 0 : (r.completed + 0.99 * r.inProgress) / r.required;
      });
      const bestScore = Math.max(...scores);
      const best = rule.rules[scores.indexOf(bestScore)];
      const result = evaluateRule(ctx, best);
      // Nothing started and every alternative is a single course: offer them all as one slot.
      if (bestScore === 0 && rule.rules.every((alt) => alt.type === "course")) {
        const options = rule.rules.map((alt) => (alt.type === "course" ? alt.code : ""));
        return { ...result, missing: [{ kind: "course", options }] };
      }
      return result;
    }

    case "choose":
      return evaluateChoose(ctx, rule);

    case "unparsed":
      return { ...emptyResult(), required: 1, missing: [{ kind: "review", text: rule.text }], needsReview: true };
  }
}

function evaluateChoose(ctx: Ctx, rule: Extract<Rule, { type: "choose" }>): NodeResult {
  const unit = rule.count !== undefined ? "courses" : "credits";
  const required = rule.count ?? rule.credits ?? 0;
  const constraints = rule.constraints ?? [];

  // Courses that may not be used here.
  const exclude = new Set<CourseCode>();
  for (const id of rule.from.excludeUsedBy ?? []) ctx.appliedBy.get(id)?.forEach((a) => exclude.add(a.code));
  for (const k of constraints) {
    if (k.type !== "notEquivalentTo") continue;
    for (const a of ctx.appliedBy.get(k.requirementId) ?? []) {
      exclude.add(a.code);
      ctx.catalog.get(a.code)?.equivalents.forEach((e) => exclude.add(e));
      // Equivalence may be recorded on either course.
      for (const course of ctx.catalog.values()) if (course.equivalents.includes(a.code)) exclude.add(course.code);
    }
  }

  const minFrom = constraints.filter((k): k is Extract<ChooseConstraint, { type: "minFrom" }> => k.type === "minFrom");
  const candidates = [...ctx.attempts.values()]
    .filter((a) => !exclude.has(a.code) && (ctx.allowReuse || !ctx.used.has(a.code)))
    .filter((a) => matchesSelector(a.code, ctx.catalog.get(a.code), rule.from))
    .sort((a, b) => {
      // Courses that satisfy a minimum-from constraint first, then completed before in-progress.
      const inMin = (x: Attempt) => (minFrom.some((k) => matchesSelector(x.code, ctx.catalog.get(x.code), k.from)) ? 0 : 1);
      return inMin(a) - inMin(b) || Number(a.status === "in-progress") - Number(b.status === "in-progress");
    });

  const result: NodeResult = { ...emptyResult(unit), required };
  const capUsage = new Map<ChooseConstraint, { courses: number; credits: number }>();
  const groupsUsed = new Set<number>();
  const measure = () => (unit === "courses" ? result.applied.length : result.applied.reduce((s, a) => s + a.credits, 0));

  for (const attempt of candidates) {
    if (measure() >= required) break;
    if (!meetsGradePolicies(ctx, attempt)) continue;
    const credits = creditsOf(ctx, attempt);

    const caps = constraints.filter(
      (k): k is Extract<ChooseConstraint, { type: "maxFrom" }> =>
        k.type === "maxFrom" && matchesSelector(attempt.code, ctx.catalog.get(attempt.code), k.from),
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
      k.type === "onePerGroup" ? k.groups.map((g, i) => (g.includes(attempt.code) ? i : -1)).filter((i) => i >= 0) : [],
    );
    if (groupIndexes.some((i) => groupsUsed.has(i))) continue;

    const applied = toApplied(ctx, attempt);
    claim(ctx, attempt, applied);
    result.applied.push(applied);
    caps.forEach((k) => {
      const usage = capUsage.get(k) ?? { courses: 0, credits: 0 };
      capUsage.set(k, { courses: usage.courses + 1, credits: usage.credits + credits });
    });
    groupIndexes.forEach((i) => groupsUsed.add(i));
  }

  const amount = (a: AppliedCourse) => (unit === "courses" ? 1 : a.credits);
  result.completed = result.applied.filter((a) => a.state === "completed").reduce((s, a) => s + amount(a), 0);
  result.inProgress = result.applied.filter((a) => a.state === "in-progress").reduce((s, a) => s + amount(a), 0);

  // A minimum-from shortfall keeps the requirement open even when the count is reached.
  for (const k of minFrom) {
    const have = result.applied.filter((a) => matchesSelector(a.code, ctx.catalog.get(a.code), k.from)).length;
    if (have < k.minCourses) {
      const deficit = k.minCourses - have;
      result.completed = Math.min(result.completed, required - deficit);
      result.inProgress = Math.min(result.inProgress, required - deficit - result.completed);
      result.missing.push({ kind: "choose", remaining: deficit, unit: "courses", pool: k.from, constraints: [], exclude: [...exclude] });
    }
  }

  const remaining = required - result.completed - result.inProgress;
  if (remaining > 0) {
    result.missing.push({ kind: "choose", remaining, unit, pool: rule.from, constraints, exclude: [...exclude] });
  }
  return result;
}

function containsChoose(rule: Rule): boolean {
  if (rule.type === "choose") return true;
  return (rule.type === "allOf" || rule.type === "anyOf") && rule.rules.some(containsChoose);
}

/** Requirement ids referenced by a requirement's choose rules. */
function dependencies(rule: Rule, ruleOwner: Map<string, string>): string[] {
  if (rule.type === "allOf" || rule.type === "anyOf") return rule.rules.flatMap((r) => dependencies(r, ruleOwner));
  if (rule.type !== "choose") return [];
  const ids = [
    ...(rule.from.excludeUsedBy ?? []),
    ...(rule.constraints ?? []).flatMap((k) => (k.type === "notEquivalentTo" ? [k.requirementId] : [])),
  ];
  return ids.map((id) => ruleOwner.get(id) ?? id);
}

function collectRuleIds(rule: Rule, owner: string, into: Map<string, string>) {
  if (rule.id) into.set(rule.id, owner);
  if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => collectRuleIds(r, owner, into));
}

/** Fixed requirements first, then choose requirements after the ones they reference. */
function evaluationOrder(requirements: ProgramRequirement[]): ProgramRequirement[] {
  const owner = new Map<string, string>();
  requirements.forEach((req) => {
    owner.set(req.id, req.id);
    collectRuleIds(req.rule, req.id, owner);
  });
  const pending = [...requirements].sort((a, b) => Number(containsChoose(a.rule)) - Number(containsChoose(b.rule)));
  const done = new Set<string>();
  const order: ProgramRequirement[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((req) => dependencies(req.rule, owner).every((d) => done.has(d) || d === req.id));
    // A dependency cycle shouldn't happen; fall back to the next requirement rather than looping.
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    order.push(next);
    done.add(next.id);
  }
  return order;
}

/** Course codes a rule requires outright: every course leaf not under an anyOf or choose. */
export function mandatoryCourses(rule: Rule): CourseCode[] {
  if (rule.type === "course") return [rule.code];
  if (rule.type === "allOf") return rule.rules.flatMap(mandatoryCourses);
  return [];
}

/** The courses a substitution puts in place, when it is a plain course or list of courses. */
export function substitutionCourses(sub: ProgramDefinition["substitutions"][number]): CourseCode[] {
  if (sub.with.type === "course") return [sub.with.code];
  if (sub.with.type === "allOf" && sub.with.rules.every((r) => r.type === "course")) {
    return sub.with.rules.map((r) => (r.type === "course" ? r.code : ""));
  }
  return [];
}

/**
 * Whether a substitution applies without an advisor. One with an eligibility
 * condition ("Students pursuing Honors") counts when another of the student's
 * programs requires its courses, e.g. the Honors CS program requiring CSE 350.
 */
export function substitutionEligible(sub: ProgramDefinition["substitutions"][number], requiredElsewhere: Set<CourseCode>): boolean {
  if (sub.requiresApproval || sub.replaces.type !== "courses") return false;
  const codes = substitutionCourses(sub);
  return codes.length > 0 && (!sub.condition || codes.every((c) => requiredElsewhere.has(c)));
}

/** Eligible course-for-course substitutions apply once all their courses are taken or in progress. */
function applySubstitutions(program: ProgramDefinition, attempts: Map<CourseCode, Attempt>, requiredElsewhere: Set<CourseCode>) {
  for (const sub of program.substitutions) {
    if (!substitutionEligible(sub, requiredElsewhere) || sub.replaces.type !== "courses") continue;
    const withCodes = substitutionCourses(sub);
    const taken = withCodes.map((code) => attempts.get(code));
    if (withCodes.length === 0 || taken.some((a) => !a)) continue;
    const status = taken.every((a) => a!.status === "completed") ? "completed" : "in-progress";
    for (const code of sub.replaces.courses) {
      if (attempts.has(code)) continue;
      attempts.set(code, { code, source: "sbu", status, credits: 0, viaSubstitution: sub.id });
    }
  }
}

function evaluatePolicies(ctx: Ctx, program: ProgramDefinition, rejectedBy: Map<string, Ctx["issues"]>): PolicyResult[] {
  const appliedTo = (ids: string[]) => {
    const seen = new Set<string>();
    return ids
      .flatMap((id) => ctx.appliedBy.get(id) ?? [])
      .filter((a) => !a.viaSubstitution && !seen.has(a.code) && seen.add(a.code));
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
          (a) => a.state === "completed" && a.source === "sbu" && a.grade && a.grade in GRADE_POINTS,
        );
        if (graded.length === 0) return { policy, status: "pending", detail: "" };
        const credits = graded.reduce((s, a) => s + a.credits, 0);
        const gpa = graded.reduce((s, a) => s + GRADE_POINTS[a.grade as LetterGrade] * a.credits, 0) / credits;
        return {
          policy,
          status: gpa >= policy.gpa ? "satisfied" : "not-met",
          detail: `${gpa.toFixed(2)} / ${policy.gpa.toFixed(2)} minimum`,
        };
      }
      case "residencyCredits": {
        const applied = appliedTo(policy.appliesTo).filter((a) => a.source === "sbu");
        const done = applied.filter((a) => a.state === "completed").reduce((s, a) => s + a.credits, 0);
        const pending = applied.filter((a) => a.state === "in-progress").reduce((s, a) => s + a.credits, 0);
        return {
          policy,
          status: done >= policy.minCredits ? "satisfied" : done + pending >= policy.minCredits ? "in-progress" : "not-met",
          detail: `${done}${pending ? ` + ${pending}` : ""} / ${policy.minCredits} credits`,
        };
      }
      case "residencyRequired": {
        const applied = appliedTo(policy.appliesTo);
        if (applied.length === 0) return { policy, status: "pending", detail: "" };
        const outside = applied.filter((a) => a.source !== "sbu");
        return outside.length > 0
          ? { policy, status: "not-met", detail: `${outside.map((a) => a.code).join(", ")} must be taken at Stony Brook` }
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
  const attempts: Map<CourseCode, Attempt> = bestAttempts(student.attempts);
  applySubstitutions(program, attempts, requiredElsewhere);

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
  };

  const byId = new Map<string, RequirementResult>();
  const rejectedBy = new Map<string, Ctx["issues"]>();
  for (const req of evaluationOrder(program.requirements)) {
    const reqCtx: Ctx = { ...ctx, scope: [req.id], issues: [] };
    const r = evaluateRule(reqCtx, req.rule);
    rejectedBy.set(req.id, reqCtx.issues);
    const issues = [...new Set(reqCtx.issues.map((i) => i.message))];
    byId.set(req.id, {
      requirement: { id: req.id, label: req.label, title: req.title, sourceText: req.sourceText },
      programId: program.id,
      status: r.needsReview && r.completed + r.inProgress < r.required ? "needs-review" : statusFor(r.required, r.completed, r.inProgress),
      unit: r.unit,
      required: r.required,
      completed: r.completed,
      inProgress: r.inProgress,
      applied: r.applied,
      missing: r.missing,
      issues,
      manualChecks: r.manualChecks,
    });
  }

  const requirements = program.requirements.map((req) => byId.get(req.id)!);
  const appliedCodes = new Set(requirements.flatMap((r) => r.applied.map((a) => a.code)));
  return {
    program,
    requirements,
    policies: evaluatePolicies(ctx, program, rejectedBy),
    satisfied: requirements.filter((r) => r.status === "satisfied").length,
    total: requirements.length,
    retakes: [...ctx.rejected].filter((code) => !appliedCodes.has(code)),
  };
}

// ---------------------------------------------------------------------------
// SBC and credits
// ---------------------------------------------------------------------------

/**
 * "Pursue Deeper Understanding by completing advanced studies in three of four
 * distinct areas of knowledge" (Undergraduate Catalog, The Stony Brook Curriculum).
 */
export const DEEPER_UNDERSTANDING = { categories: ["EXP+", "HFA+", "SBS+", "STEM+"] as SbcCode[], required: 3 };

export function auditSbc(
  student: StudentRecord,
  catalog: Map<CourseCode, CourseRecord>,
  categories: SbcCategory[],
  programs: ProgramDefinition[],
): SbcAudit {
  const attempts = [...bestAttempts(student.attempts).values()].sort(
    (a, b) => Number(a.status === "in-progress") - Number(b.status === "in-progress"),
  );
  const exemptions = new Map<SbcCode, string>(programs.flatMap((p) => p.sbc.exemptions.map((e) => [e.category, e.reason])));

  const results = categories.map((category): SbcResult => {
    const exemptReason = exemptions.get(category.code);
    if (exemptReason) return { category, status: "exempt", exemptReason };
    // Transcript-printed tags count too; partial-fulfillment tags don't satisfy a category alone.
    const match = attempts.find(
      (a) =>
        a.sbc?.includes(category.code) ||
        catalog.get(a.code)?.sbc.some((tag) => tag.category === category.code && !tag.partial),
    );
    if (!match) return { category, status: "not-started" };
    return { category, status: match.status === "completed" ? "satisfied" : "in-progress", appliedCode: match.code };
  });

  // Only three of the four upper-tier categories are required. Once three are met,
  // the fourth isn't needed; it counts toward neither the total nor the satisfied count.
  const met = (r: SbcResult) => r.status === "satisfied" || r.status === "exempt";
  const isDeeper = (r: SbcResult) => DEEPER_UNDERSTANDING.categories.includes(r.category.code);
  const deeper = results.filter(isDeeper);
  if (deeper.filter(met).length >= DEEPER_UNDERSTANDING.required) {
    for (const r of deeper) {
      if (met(r) || r.status === "in-progress") continue;
      r.status = "exempt";
      r.exemptReason = `Not required: ${DEEPER_UNDERSTANDING.required} of the ${DEEPER_UNDERSTANDING.categories.length} Pursue Deeper Understanding categories are met`;
    }
  }
  const optional = deeper.length - Math.min(deeper.length, DEEPER_UNDERSTANDING.required);

  return {
    results,
    satisfied:
      results.filter((r) => !isDeeper(r) && met(r)).length +
      Math.min(deeper.filter((r) => met(r) && !r.exemptReason?.startsWith("Not required")).length, DEEPER_UNDERSTANDING.required),
    total: results.length - optional,
  };
}

export function summarizeCredits(
  student: StudentRecord,
  catalog: Map<CourseCode, CourseRecord>,
  rules: { totalCredits: number; upperDivisionCredits: number; upperDivisionMinNumber: number },
): CreditSummary {
  const bySource: Record<CreditSource, number> = { sbu: 0, transfer: 0, ap: 0 };
  const upperDivision = { required: rules.upperDivisionCredits, earned: 0, inProgress: 0 };
  let earned = 0;
  let inProgress = 0;

  for (const attempt of bestAttempts(student.attempts).values()) {
    const credits = attempt.credits ?? catalog.get(attempt.code)?.credits.max ?? 0;
    const upper = parseCode(attempt.code).number >= rules.upperDivisionMinNumber;
    if (attempt.status === "in-progress") {
      inProgress += credits;
      if (upper) upperDivision.inProgress += credits;
    } else if (attempt.grade && isPassing(attempt.grade)) {
      earned += credits;
      bySource[attempt.source] += credits;
      if (upper) upperDivision.earned += credits;
    }
  }

  return { required: rules.totalCredits, earned, inProgress, bySource, upperDivision, standing: standingFor(earned) };
}

/** Courses that the other enrolled programs require outright. */
export function requiredByOthers(program: ProgramDefinition, enrolled: ProgramDefinition[]): Set<CourseCode> {
  return new Set(
    enrolled.filter((p) => p !== program).flatMap((p) => p.requirements.flatMap((r) => mandatoryCourses(r.rule))),
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
    programs: enrolled.map((p) => auditProgram(p, student, catalog, requiredByOthers(p, enrolled))),
    sbc: auditSbc(student, catalog, sbcCategories, enrolled),
    credits: summarizeCredits(student, catalog, creditRules),
  };
}
