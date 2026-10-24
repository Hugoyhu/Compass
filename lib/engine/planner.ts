/**
 * Next-semester proposal: a deliberately simple greedy heuristic, not an
 * optimizer. It picks eligible courses (prerequisites met assuming current
 * in-progress courses are passed) that close the most important open
 * requirements, then fills to a target credit load.
 *
 * Offering data is incomplete, so a course with no known section in the term
 * is "unconfirmed", never excluded. Confirmed courses rank slightly higher.
 */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import type { CourseCode, LetterGrade, StudentRecord, TermId } from "@/lib/domain/types";
import { nextRegularTerm } from "@/lib/domain/terms";
import { matchesSelector, type DegreeAudit } from "./audit";
import { requirementHeading } from "./describe";
import {
  buildCompletionIndex,
  evaluatePrereq,
  plannedCredits,
  referencedCourses,
  standingFor,
  usableAttempts,
} from "./prerequisites";

export type NeedKind = "required" | "sbc" | "elective";

interface Need {
  requirementId: string;
  title: string;
  kind: NeedKind;
  options: Set<CourseCode>;
  remaining: number;
}

export interface ProposedCourse {
  course: CourseRecord;
  fills: { requirementId: string; title: string; kind: NeedKind }[];
  /** Prerequisite conditions the planner couldn't verify, e.g. instructor permission. */
  checks: string[];
  /** True when this retakes a course whose earlier grade didn't count. */
  retake: boolean;
  /** Main-campus sections known for the term; null when unknown. */
  sections: number | null;
}

export interface SemesterProposal {
  term: TermId;
  courses: ProposedCourse[];
  totalCredits: number;
  /** Open needs the proposal could not address this term, with a reason. */
  deferred: { title: string; reason: string }[];
}

const KIND_WEIGHT: Record<NeedKind, number> = { required: 30, sbc: 20, elective: 10 };
/** Enough to prefer a confirmed course among similar options, not to outrank a more important need. */
const CONFIRMED_BONUS = 5;

function needsFrom(audit: DegreeAudit, courses: CourseRecord[]): { needs: Need[]; review: string[] } {
  const needs: Need[] = [];
  const review: string[] = [];
  for (const program of audit.programs) {
    for (const r of program.requirements) {
      if (r.status === "satisfied" || r.status === "in-progress") continue;
      r.missing.forEach((item, i) => {
        const requirementId = `${r.requirement.id}#${i}`;
        const title = requirementHeading(r.requirement);
        if (item.kind === "course") {
          needs.push({ requirementId, title, kind: "required", options: new Set(item.options), remaining: 1 });
        } else if (item.kind === "choose") {
          // Capped pools (research, VIP) are left to students to add by hand.
          const capped = (code: CourseCode, course: CourseRecord) =>
            item.constraints.some((k) => k.type === "maxFrom" && matchesSelector(code, course, k.from));
          const options = courses
            .filter((c) => !item.exclude.includes(c.code) && matchesSelector(c.code, c, item.pool) && !capped(c.code, c))
            .map((c) => c.code);
          const remaining = item.unit === "courses" ? item.remaining : Math.ceil(item.remaining / 3);
          needs.push({ requirementId, title, kind: "elective", options: new Set(options), remaining });
        } else {
          review.push(`${title}: ${item.text}`);
        }
      });
    }
  }
  for (const s of audit.sbc.results) {
    if (s.status !== "not-started" && s.status !== "partial") continue;
    const options = courses.filter((c) => c.sbc.some((t) => t.category === s.category.code && !t.partial)).map((c) => c.code);
    needs.push({
      requirementId: `sbc-${s.category.code}`,
      title: `SBC ${s.category.code}`,
      kind: "sbc",
      options: new Set(options),
      remaining: 1,
    });
  }
  return { needs, review };
}

/** The most common subject among a program's course rules, e.g. "CSE" for the CS BS. */
function primarySubject(program: ProgramDefinition): string {
  const counts = new Map<string, number>();
  const visit = (rule: Rule) => {
    if (rule.type === "course") counts.set(rule.code.split(" ")[0], (counts.get(rule.code.split(" ")[0]) ?? 0) + 1);
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
    if (rule.type === "choose") rule.from.subjects?.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
  };
  program.requirements.forEach((r) => visit(r.rule));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** How many not-yet-taken courses list this course as a prerequisite. */
function unlockCounts(courses: CourseRecord[], taken: Set<CourseCode>): Map<CourseCode, number> {
  const counts = new Map<CourseCode, number>();
  for (const course of courses) {
    if (taken.has(course.code)) continue;
    for (const code of new Set(referencedCourses(course.prerequisites))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

export function proposeNextSemester({
  audit,
  student,
  courses,
  term,
  sectionCounts,
  targetCredits = 15,
  maxCredits = 18,
}: {
  audit: DegreeAudit;
  student: StudentRecord;
  courses: CourseRecord[];
  term: TermId;
  /** Main-campus sections per course in `term`; null when the term has no offering data. */
  sectionCounts: Map<CourseCode, number> | null;
  targetCredits?: number;
  maxCredits?: number;
}): SemesterProposal {
  const retakes = new Set(audit.programs.flatMap((p) => p.retakes));
  const taken = new Set(usableAttempts(student.attempts).map((a) => a.code).filter((code) => !retakes.has(code)));

  // Program rules such as "C or higher in prerequisites for CSE courses".
  const prereqGrades = new Map<string, LetterGrade>();
  for (const program of audit.programs) {
    for (const policy of program.program.policies) {
      if (policy.type === "prerequisiteGrade") policy.subjects.forEach((s) => prereqGrades.set(s, policy.minGrade));
    }
  }
  const index = buildCompletionIndex(student.attempts, { includeInProgress: true });
  const majorSubjects = audit.programs.filter((p) => p.program.kind === "major").map((p) => primarySubject(p.program));
  const standing = standingFor(audit.credits.earned + audit.credits.inProgress);
  const prereqsFor = (c: CourseRecord) =>
    evaluatePrereq(c.prerequisites, { index, standing, majorSubjects, defaultMinGrade: prereqGrades.get(c.code.split(" ")[0]) });

  const unlocks = unlockCounts(courses, taken);
  // The catalog's sample sequence names the usual choice (e.g. "CSE 416 or CSE 356" lists 416 first).
  const recommended = new Set(
    audit.programs.flatMap((p) =>
      (p.program.sampleSequence ?? []).flatMap((t) => t.slots.flatMap((s) => (s.kind === "course" ? [s.code] : []))),
    ),
  );
  const { needs, review } = needsFrom(audit, courses);
  const sectionsFor = (c: CourseRecord) => (sectionCounts ? (sectionCounts.get(c.code) ?? null) : null);
  const isEligible = (c: CourseRecord) => !taken.has(c.code) && prereqsFor(c).met;
  let candidates = courses.filter(isEligible);

  const score = (c: CourseRecord) => {
    const weights = needs
      .filter((n) => n.remaining > 0 && n.options.has(c.code))
      .map((n) => KIND_WEIGHT[n.kind])
      .sort((a, b) => b - a);
    if (weights.length === 0) return 0;
    // Primary need dominates; secondary needs (e.g. an SBC the course also carries) break ties.
    const [primary, ...rest] = weights;
    return (
      primary +
      rest.reduce((s, w) => s + w / 5, 0) +
      (unlocks.get(c.code) ?? 0) * 2 +
      (recommended.has(c.code) ? 1 : 0) +
      (sectionsFor(c) ? CONFIRMED_BONUS : 0) -
      Number(c.code.split(" ")[1]) / 1000
    );
  };

  const picked: ProposedCourse[] = [];
  let total = 0;
  while (total < targetCredits) {
    const best = candidates
      .filter((c) => total + plannedCredits(c) <= maxCredits)
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0];
    if (!best) break;

    // Within a program a course counts once (majors disallow reuse), so it fills its most
    // important program need; SBC objectives may overlap with major courses.
    const matching = needs.filter((n) => n.remaining > 0 && n.options.has(best.c.code));
    const programNeed = matching.filter((n) => n.kind !== "sbc").sort((a, b) => KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind])[0];
    const fills = [...(programNeed ? [programNeed] : []), ...matching.filter((n) => n.kind === "sbc")];
    fills.forEach((n) => n.remaining--);
    picked.push({
      course: best.c,
      fills: fills.map((n) => ({ requirementId: n.requirementId, title: n.title, kind: n.kind })),
      checks: prereqsFor(best.c).unverifiable,
      retake: retakes.has(best.c.code),
      sections: sectionsFor(best.c),
    });
    total += plannedCredits(best.c);
    candidates = candidates.filter((c) => c.code !== best.c.code);
  }

  const deferred = [
    ...needs
      .filter((n) => n.remaining > 0)
      .map((n) => {
        const options = courses.filter((c) => n.options.has(c.code) && !taken.has(c.code));
        const reason = options.some(isEligible)
          ? "Credit load reached"
          : options.length === 0
            ? "No matching courses in the catalog data"
            : "Prerequisites not yet met";
        return { title: n.title, reason };
      }),
    ...review.map((text) => ({ title: text, reason: "Needs advisor review" })),
  ];

  return { term, courses: picked, totalCredits: total, deferred };
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
