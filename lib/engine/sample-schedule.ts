/**
 * Where the catalog's suggested semester-by-semester schedule puts each course,
 * so the scheduler can follow it more or less. Only the student's primary major
 * counts: of their majors that have a suggested schedule, the one with the most
 * credits. Minors are worked in around it. Special programs (the Honors
 * College) list only their own courses, so their schedules apply alongside it.
 */
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import type { CourseCode, StudentRecord } from "@/lib/domain/types";

/** The major whose suggested schedule guides the plan, or null when no major has one. */
export function primaryMajor(programs: ProgramDefinition[]): ProgramDefinition | null {
  const withSchedule = programs.filter((p) => p.kind === "major" && p.sampleSequence?.length);
  return withSchedule.reduce<ProgramDefinition | null>((best, p) => (!best || (p.approxCredits ?? 0) > (best.approxCredits ?? 0) ? p : best), null);
}

/**
 * Each course's suggested semester, as an index among the student's fall and
 * spring semesters (0 = their first, as from `semesterIndex`). A course the
 * schedule offers as "X or Y" is suggested under both codes. A student who
 * entered in spring starts at the schedule's second semester, so its fall
 * courses come out negative: already due.
 */
export function suggestedSemesters(programs: ProgramDefinition[], student: StudentRecord): Map<CourseCode, number> {
  const targets = new Map<CourseCode, number>();
  const primary = primaryMajor(programs);
  const sequence = [primary, ...programs.filter((p) => p.kind === "program")].flatMap((p) => p?.sampleSequence ?? []);
  const offset = student.entryTerm.endsWith("SP") ? 1 : 0;
  const regular = sequence
    .filter((t) => t.season === "Fall" || t.season === "Spring")
    .sort((a, b) => a.year - b.year || (a.season === b.season ? 0 : a.season === "Fall" ? -1 : 1));
  // A year missing a season still counts both, so years stay two semesters apart.
  for (const term of regular) {
    const index = (term.year - 1) * 2 + (term.season === "Spring" ? 1 : 0) - offset;
    for (const slot of term.slots) {
      if (slot.kind !== "course") continue;
      for (const code of [slot.code, ...(slot.alternatives ?? [])]) targets.set(code, Math.min(targets.get(code) ?? Infinity, index));
    }
  }
  return targets;
}
