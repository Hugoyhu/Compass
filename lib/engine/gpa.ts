/** Stony Brook GPA: completed Stony Brook courses with a letter grade, weighted by credits. */
import type { CourseAttempt } from "@/lib/domain/types";
import type { LetterGrade } from "@/lib/domain/catalog/common";
import { GRADE_POINTS } from "./audit";

export interface Gpa {
  /** 4.0 scale; 0 when no graded Stony Brook credits exist yet. */
  value: number;
  credits: number;
}

/** Transfer and exam credit never enter the GPA, nor do pass/fail, withdrawn, or in-progress courses. */
export function computeGpa(attempts: CourseAttempt[], creditsOf: (attempt: CourseAttempt) => number): Gpa {
  let credits = 0;
  let points = 0;
  for (const a of attempts) {
    if (a.source !== "sbu" || a.status !== "completed" || !a.grade || !(a.grade in GRADE_POINTS)) continue;
    const c = creditsOf(a);
    credits += c;
    points += GRADE_POINTS[a.grade as LetterGrade] * c;
  }
  return { value: credits > 0 ? points / credits : 0, credits };
}
