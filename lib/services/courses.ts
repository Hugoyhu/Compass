/**
 * Assembles the Course Explorer: a searchable list of every course, and one
 * course's details. When the visitor has a record, both say where the course
 * stands for them (taken, planned, or whether its prerequisites are met).
 */
import { DEFAULT_CURRENT_TERM } from "@/components/record/options";
import { getRepository } from "@/lib/data/repository";
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { Section } from "@/lib/domain/catalog/offering";
import type { Rule } from "@/lib/domain/catalog/program";
import { nextRegularTerm, termOrdinal } from "@/lib/domain/terms";
import type { CourseCode, StudentRecord, TermId } from "@/lib/domain/types";
import { matchesSelector, runDegreeAudit } from "@/lib/engine/audit";
import { requirementHeading } from "@/lib/engine/describe";
import { prerequisiteChecker } from "@/lib/engine/planner";
import { buildCompletionIndex, referencedCourses, usableAttempts } from "@/lib/engine/prerequisites";

export type CourseStatus = "taken" | "in-progress" | "planned" | "can-take" | "prereqs-missing";

export interface CourseSummary {
  code: CourseCode;
  title: string;
  credits: string;
  sbc: string[];
  /** Main-campus sections in `scheduleTerm`. */
  scheduled: boolean;
  status: CourseStatus | null;
}

export function formatCredits({ min, max }: CourseRecord["credits"]): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

async function catalogData() {
  const repo = getRepository();
  const [courses, programs, sbcCategories, creditRules, offeringTerms] = await Promise.all([
    repo.listCourses(),
    repo.listPrograms(),
    repo.listSbcCategories(),
    repo.getUniversityCreditRules(),
    repo.listOfferingTerms(),
  ]);
  return { courses, programs, sbcCategories, creditRules, offeringTerms };
}

/** Where each course stands for the student; null without a record. */
function statusFor(data: Awaited<ReturnType<typeof catalogData>>, student: StudentRecord | null) {
  if (!student) return null;
  const audit = runDegreeAudit({ ...data, student });
  const prereqsFor = prerequisiteChecker(audit, student);
  const usable = usableAttempts(student.attempts);
  const taken = new Set(usable.filter((a) => a.status === "completed").map((a) => a.code));
  const inProgress = new Set(usable.filter((a) => a.status === "in-progress").map((a) => a.code));
  const planned = new Map<CourseCode, TermId>();
  for (const t of student.plan) for (const i of t.items) if ("code" in i && !planned.has(i.code)) planned.set(i.code, t.term);

  return {
    audit,
    planned,
    prereqsFor,
    of(course: CourseRecord): CourseStatus {
      if (taken.has(course.code)) return "taken";
      if (inProgress.has(course.code)) return "in-progress";
      if (planned.has(course.code)) return "planned";
      return prereqsFor(course).met ? "can-take" : "prereqs-missing";
    },
  };
}

/** The term whose schedule the explorer shows: the student's next fall or spring. */
function scheduleTermFor(student: StudentRecord | null): TermId {
  return nextRegularTerm(student?.currentTerm ?? DEFAULT_CURRENT_TERM);
}

function mainCampusCodes(sections: Section[] | null): Set<CourseCode> {
  return new Set((sections ?? []).filter((s) => s.campus === "main").map((s) => s.code));
}

export async function listCourseSummaries(student: StudentRecord | null) {
  const data = await catalogData();
  const status = statusFor(data, student);
  const scheduleTerm = scheduleTermFor(student);
  const scheduled = mainCampusCodes(await getRepository().listSections(scheduleTerm));

  const courses: CourseSummary[] = data.courses.map((c) => ({
    code: c.code,
    title: c.title,
    credits: formatCredits(c.credits),
    sbc: c.sbc.filter((t) => !t.partial).map((t) => t.category),
    scheduled: scheduled.has(c.code),
    status: status?.of(c) ?? null,
  }));
  return { courses, scheduleTerm: scheduled.size > 0 ? scheduleTerm : null };
}

export async function getCourseDetail(code: CourseCode, student: StudentRecord | null) {
  const data = await catalogData();
  const byCode = new Map(data.courses.map((c) => [c.code, c]));
  const course = byCode.get(code);
  if (!course) return null;
  const titleOf = (c: CourseCode) => ({ code: c, title: byCode.get(c)?.title ?? null });

  const repo = getRepository();
  const sections = (
    await Promise.all(
      data.offeringTerms.map(async (term) => ({
        term,
        sections: ((await repo.listSections(term)) ?? []).filter((s) => s.code === code),
      })),
    )
  ).filter((t) => t.sections.length > 0);

  const unlocks = data.courses
    .filter((c) => c.code !== code && referencedCourses(c.prerequisites).includes(code))
    .map((c) => titleOf(c.code));

  const status = statusFor(data, student);
  // Requirements of the student's programs this course can count toward.
  const countsToward: { program: string; requirement: string }[] = [];
  for (const p of status?.audit.programs ?? []) {
    for (const r of p.program.requirements) {
      if (ruleMentions(r.rule, code, course)) countsToward.push({ program: p.program.name, requirement: requirementHeading(r) });
    }
  }

  // Completion state of every course the prerequisite tree names, for marking it up.
  const index = student ? buildCompletionIndex(student.attempts, { includeInProgress: true }) : null;
  const prereqCourses: Record<string, { title: string | null; state: "done" | "in-progress" | "planned" | "missing" | null }> = {};
  for (const c of referencedCourses(course.prerequisites)) {
    const state = index?.get(c);
    prereqCourses[c] = {
      title: byCode.get(c)?.title ?? null,
      state: !student
        ? null
        : state === "in-progress"
          ? "in-progress"
          : state
            ? "done"
            : status?.planned.has(c)
              ? "planned"
              : "missing",
    };
  }

  return {
    course,
    credits: formatCredits(course.credits),
    sections,
    unlocks,
    equivalents: course.equivalents.map(titleOf),
    countsToward,
    prereqCourses,
    status: status?.of(course) ?? null,
    plannedTerm: status?.planned.get(code) ?? null,
    unverifiable: status?.prereqsFor(course).unverifiable ?? [],
    // Plan terms first, then the next two years of fall and spring terms.
    planTerms: student ? upcomingPlanTerms(student) : [],
    hasRecord: !!student,
  };
}

export type CourseDetail = NonNullable<Awaited<ReturnType<typeof getCourseDetail>>>;

function ruleMentions(rule: Rule, code: CourseCode, course: CourseRecord): boolean {
  switch (rule.type) {
    case "course":
      return rule.code === code;
    case "allOf":
    case "anyOf":
      return rule.rules.some((r) => ruleMentions(r, code, course));
    case "choose":
      return matchesSelector(code, course, rule.from);
    case "unparsed":
      return false;
  }
}

function upcomingPlanTerms(student: StudentRecord): TermId[] {
  const terms = new Set(student.plan.map((t) => t.term));
  let term = student.currentTerm;
  for (let i = 0; i < 4; i++) terms.add((term = nextRegularTerm(term)));
  return [...terms].sort((a, b) => termOrdinal(a) - termOrdinal(b));
}
