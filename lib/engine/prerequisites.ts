import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { CourseAttempt, CourseCode, Grade, LetterGrade } from "@/lib/domain/types";

const LETTER_ORDER: LetterGrade[] = ["F", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A"];
const NON_PASSING: Grade[] = ["F", "NC", "W", "I"];

/** "in-progress" entries are treated as satisfied when planning future terms. */
export type CompletionState = Grade | "in-progress";
export type CompletionIndex = Map<CourseCode, CompletionState>;

export function isPassing(grade: Grade): boolean {
  return !NON_PASSING.includes(grade);
}

/** Pass/transfer credit is treated as meeting a letter-grade floor. */
export function meetsMinGrade(grade: Grade, min: LetterGrade): boolean {
  if (grade === "P" || grade === "T") return true;
  const g = LETTER_ORDER.indexOf(grade as LetterGrade);
  return g !== -1 && g >= LETTER_ORDER.indexOf(min);
}

/** Attempts that count toward requirements: passed courses plus in-progress ones. */
export function usableAttempts(attempts: CourseAttempt[]): CourseAttempt[] {
  return attempts.filter((a) => a.status === "in-progress" || (a.grade !== undefined && isPassing(a.grade)));
}

/** Best grade per course; in-progress entries only when requested. */
export function buildCompletionIndex(
  attempts: CourseAttempt[],
  { includeInProgress }: { includeInProgress: boolean },
): CompletionIndex {
  const index: CompletionIndex = new Map();
  for (const attempt of usableAttempts(attempts)) {
    if (attempt.status === "in-progress") {
      if (includeInProgress && !index.has(attempt.code)) index.set(attempt.code, "in-progress");
      continue;
    }
    const current = index.get(attempt.code);
    const better =
      current === undefined ||
      current === "in-progress" ||
      LETTER_ORDER.indexOf(attempt.grade as LetterGrade) > LETTER_ORDER.indexOf(current as LetterGrade);
    if (better) index.set(attempt.code, attempt.grade!);
  }
  return index;
}

/** Undergraduate class standing by earned credits (U1 0–23, U2 24–56, U3 57–84, U4 85+). */
export function standingFor(credits: number): "U1" | "U2" | "U3" | "U4" {
  if (credits >= 85) return "U4";
  if (credits >= 57) return "U3";
  if (credits >= 24) return "U2";
  return "U1";
}

export interface PrereqContext {
  index: CompletionIndex;
  standing: "U1" | "U2" | "U3" | "U4";
  /** Program policy, e.g. "C or higher in prerequisites for CSE courses". */
  defaultMinGrade?: LetterGrade;
  /** Subject codes of the student's majors (e.g. ["CSE"]), to check "CSE major" restrictions. */
  majorSubjects?: string[];
}

export interface PrereqResult {
  met: boolean;
  /** Conditions that can't be checked from a transcript (permission, program, unparsed text). */
  unverifiable: string[];
}

export function evaluatePrereq(expr: Prereq | undefined, ctx: PrereqContext): PrereqResult {
  if (!expr) return { met: true, unverifiable: [] };
  switch (expr.type) {
    case "course": {
      const state = ctx.index.get(expr.code);
      if (state === undefined) return { met: false, unverifiable: [] };
      const min = expr.minGrade ?? ctx.defaultMinGrade;
      const met = state === "in-progress" || !min || meetsMinGrade(state, min);
      return { met, unverifiable: [] };
    }
    case "standing":
      return { met: ctx.standing >= expr.level, unverifiable: [] };
    case "program": {
      // "CSE, ISE or DAS major" is met when it names the student's major subject.
      const named = /major/i.test(expr.text) && ctx.majorSubjects?.some((s) => new RegExp(`\\b${s}\\b`).test(expr.text));
      return { met: true, unverifiable: named ? [] : [expr.text] };
    }
    case "permission":
    case "unparsed":
      // Assume met so planning can proceed, but surface the condition.
      return { met: true, unverifiable: [expr.text] };
    case "and": {
      const parts = expr.of.map((e) => evaluatePrereq(e, ctx));
      return { met: parts.every((p) => p.met), unverifiable: parts.flatMap((p) => p.unverifiable) };
    }
    case "or": {
      const parts = expr.of.map((e) => evaluatePrereq(e, ctx));
      const met = parts.filter((p) => p.met);
      return { met: met.length > 0, unverifiable: met.length > 0 ? met[0].unverifiable : [] };
    }
  }
}

/** All course codes referenced anywhere in an expression. */
export function referencedCourses(expr: Prereq | undefined): CourseCode[] {
  if (!expr) return [];
  if (expr.type === "course") return [expr.code];
  if (expr.type === "and" || expr.type === "or") return expr.of.flatMap(referencedCourses);
  return [];
}

export function formatPrereq(expr: Prereq | undefined): string {
  if (!expr) return "None";
  const fmt = (e: Prereq, nested: boolean): string => {
    switch (e.type) {
      case "course":
        return `${e.code}${e.minGrade ? ` (${e.minGrade} or higher)` : ""}${e.concurrentAllowed ? " (may be concurrent)" : ""}`;
      case "standing":
        return `${e.level} standing`;
      case "program":
      case "permission":
      case "unparsed":
        return e.text;
      case "and":
      case "or": {
        const joined = e.of.map((x) => fmt(x, true)).join(e.type === "and" ? " and " : " or ");
        return nested ? `(${joined})` : joined;
      }
    }
  };
  return fmt(expr, false);
}

/** Catalog credit value used for planning: the maximum of a variable range. */
export function plannedCredits(course: Pick<CourseRecord, "credits">): number {
  return course.credits.max;
}
