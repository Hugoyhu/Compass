/**
 * Assembles the Degree Progress page: one of the student's programs, shown
 * like the Degree Explorer with the student's status on top.
 */
import type { CreditSource, Grade, StudentRecord } from "@/lib/domain/types";
import type { DegreeAudit } from "@/lib/engine/audit";
import { isPassing } from "@/lib/engine/prerequisites";
import { getStudentView } from "./dashboard";
import { courseInfoFor, programCourseCodes } from "./degrees";

/** A student's standing in one course, shown next to it in the Degree Progress view. */
export interface CourseStatus {
  state: "completed" | "in-progress" | "planned" | "not-counted";
  grade?: Grade;
  source?: CreditSource;
}

const GRADE_RANK: Grade[] = ["F", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "P", "T"];

/**
 * Each course's status for the student: completed (best grade), in progress,
 * planned, or completed but not counting (a grade below a requirement's minimum).
 */
export function courseStatuses(student: StudentRecord, audit: DegreeAudit): Record<string, CourseStatus> {
  const statuses: Record<string, CourseStatus> = {};
  for (const term of student.plan) {
    for (const item of term.items) if ("code" in item) statuses[item.code] = { state: "planned" };
  }
  for (const attempt of student.attempts) {
    const current = statuses[attempt.code];
    if (attempt.status === "in-progress") {
      if (current?.state !== "completed") statuses[attempt.code] = { state: "in-progress", source: attempt.source };
    } else if (attempt.grade && isPassing(attempt.grade)) {
      const better = current?.state !== "completed" || GRADE_RANK.indexOf(attempt.grade) > GRADE_RANK.indexOf(current.grade!);
      if (better) statuses[attempt.code] = { state: "completed", grade: attempt.grade, source: attempt.source };
    }
  }
  for (const program of audit.programs) {
    for (const code of program.retakes) {
      if (statuses[code]?.state === "completed") statuses[code] = { ...statuses[code], state: "not-counted" };
    }
  }
  return statuses;
}

export async function getProgressView(student: StudentRecord, programId: string | undefined) {
  const view = await getStudentView(student);
  const selected = view.programs.find((p) => p.program.id === programId) ?? view.programs[0];
  if (!selected) return { view, selected: null };

  // Titles for everything the page can show: the program's courses and the student's own.
  const courseInfo = await courseInfoFor([...programCourseCodes(selected.program), ...student.attempts.map((a) => a.code)]);
  for (const attempt of student.attempts) {
    courseInfo[attempt.code] ??= { title: view.labels[attempt.code]?.title ?? "Unknown course", credits: attempt.credits !== undefined ? `${attempt.credits} cr` : "" };
  }
  return { view, selected, courseInfo, statuses: courseStatuses(student, view.audit) };
}
