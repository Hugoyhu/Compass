/**
 * Prerequisite checking for a student's next term, and a rough graduation estimate.
 */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import type { CourseCode, LetterGrade, StudentRecord, TermId } from "@/lib/domain/types";
import { nextRegularTerm } from "@/lib/domain/terms";
import { requiredByOthers, substitutionCourses, substitutionEligible, type DegreeAudit } from "./audit";
import {
  buildCompletionIndex,
  evaluatePrereq,
  standingFor,
} from "./prerequisites";

/**
 * Courses a program lets the student replace with ones another of their programs
 * requires anyway: for an Honors CS student, CSE 114/214/307 (replaced by the
 * CSE 160/161/260/261 sequence). Planning both tracks would duplicate work.
 */
export function replacedByOtherPrograms(audit: DegreeAudit): Set<CourseCode> {
  const enrolled = audit.programs.map((p) => p.program);
  const replaced = new Set<CourseCode>();
  for (const program of enrolled) {
    const elsewhere = requiredByOthers(program, enrolled);
    for (const sub of program.substitutions) {
      if (sub.replaces.type !== "courses" || !substitutionEligible(sub, elsewhere)) continue;
      if (substitutionCourses(sub).every((c) => elsewhere.has(c))) sub.replaces.courses.forEach((c) => replaced.add(c));
    }
  }
  return replaced;
}

/** The most common subject among a program's course rules, e.g. "CSE" for the CS BS. */
export function primarySubject(program: ProgramDefinition): string {
  const counts = new Map<string, number>();
  const visit = (rule: Rule) => {
    if (rule.type === "course") counts.set(rule.code.split(" ")[0], (counts.get(rule.code.split(" ")[0]) ?? 0) + 1);
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
    if (rule.type === "choose") rule.from.subjects?.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
  };
  program.requirements.forEach((r) => visit(r.rule));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * Checks a course's prerequisites for the student's next term: in-progress
 * courses count as passed, and program rules such as "C or higher in
 * prerequisites for CSE courses" apply.
 */
export function prerequisiteChecker(audit: DegreeAudit, student: StudentRecord) {
  const prereqGrades = new Map<string, LetterGrade>();
  for (const program of audit.programs) {
    for (const policy of program.program.policies) {
      if (policy.type === "prerequisiteGrade") policy.subjects.forEach((s) => prereqGrades.set(s, policy.minGrade));
    }
  }
  const index = buildCompletionIndex(student.attempts, { includeInProgress: true });
  const majorSubjects = audit.programs.filter((p) => p.program.kind === "major").map((p) => primarySubject(p.program));
  const standing = standingFor(audit.credits.earned + audit.credits.inProgress);
  return (c: Pick<CourseRecord, "code" | "prerequisites">) =>
    evaluatePrereq(c.prerequisites, { index, standing, majorSubjects, defaultMinGrade: prereqGrades.get(c.code.split(" ")[0]) });
}

/**
 * Rough graduation estimate from remaining credits at a steady load.
 * Ignores prerequisite chains and offering patterns — label it as an estimate.
 */
export function estimateGraduationTerm(
  audit: DegreeAudit,
  currentTerm: TermId,
  creditsPerTerm = 15,
): { term: TermId; semestersRemaining: number } {
  const remaining = Math.max(0, audit.credits.required - audit.credits.earned - audit.credits.inProgress);
  const semestersRemaining = Math.ceil(remaining / creditsPerTerm);
  let term = currentTerm;
  for (let i = 0; i < semestersRemaining; i++) term = nextRegularTerm(term);
  return { term, semestersRemaining };
}
