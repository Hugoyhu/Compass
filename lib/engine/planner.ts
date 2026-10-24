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
import { matchesSelector, requiredByOthers, substitutionCourses, substitutionEligible, type DegreeAudit } from "./audit";
import { requirementHeading } from "./describe";
import {
  buildCompletionIndex,
  evaluatePrereq,
  pairedCorequisite,
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
/**
 * Per course level above the student's standing (a 400-level course for a U1
 * student is three levels above), so senior courses whose standing
 * prerequisite the catalog doesn't state still wait for later terms.
 */
const LEVEL_PENALTY = 5;

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

function needsFrom(audit: DegreeAudit, courses: CourseRecord[]): { needs: Need[]; review: string[]; replaced: Set<CourseCode> } {
  const needs: Need[] = [];
  const review: string[] = [];
  const replaced = replacedByOtherPrograms(audit);
  for (const program of audit.programs) {
    for (const r of program.requirements) {
      if (r.status === "satisfied" || r.status === "in-progress") continue;
      r.missing.forEach((item, i) => {
        const requirementId = `${r.requirement.id}#${i}`;
        const title = requirementHeading(r.requirement);
        if (item.kind === "course" && item.options.every((c) => replaced.has(c))) return;
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
  return { needs, review, replaced };
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
 * How many not-yet-taken courses the student still needs list this course as a
 * prerequisite. Counting every course in the catalog would favor popular intro
 * courses (BIO 201 is a prerequisite for dozens) over required ones.
 */
function unlockCounts(courses: CourseRecord[], taken: Set<CourseCode>, needed: Set<CourseCode>): Map<CourseCode, number> {
  const counts = new Map<CourseCode, number>();
  for (const course of courses) {
    if (taken.has(course.code) || !needed.has(course.code)) continue;
    for (const code of new Set(referencedCourses(course.prerequisites))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Checks a course's prerequisites for the student's next term: in-progress
 * courses count as passed, and program rules such as "C or higher in
 * prerequisites for CSE courses" apply.
 */
export function prerequisiteChecker(
  audit: DegreeAudit,
  student: StudentRecord,
  /** Credits the audit can't see, such as planned electives, that still count toward standing. */
  extraCredits = 0,
) {
  const prereqGrades = new Map<string, LetterGrade>();
  for (const program of audit.programs) {
    for (const policy of program.program.policies) {
      if (policy.type === "prerequisiteGrade") policy.subjects.forEach((s) => prereqGrades.set(s, policy.minGrade));
    }
  }
  const index = buildCompletionIndex(student.attempts, { includeInProgress: true });
  const majorSubjects = audit.programs.filter((p) => p.program.kind === "major").map((p) => primarySubject(p.program));
  const standing = standingFor(audit.credits.earned + audit.credits.inProgress + extraCredits);
  return (c: Pick<CourseRecord, "code" | "prerequisites">) =>
    evaluatePrereq(c.prerequisites, { index, standing, majorSubjects, defaultMinGrade: prereqGrades.get(c.code.split(" ")[0]) });
}

export function proposeNextSemester({
  audit,
  student,
  courses,
  term,
  sectionCounts,
  targetCredits = 15,
  maxCredits = 18,
  pickForSbc = true,
}: {
  audit: DegreeAudit;
  student: StudentRecord;
  courses: CourseRecord[];
  term: TermId;
  /** Main-campus sections per course in `term`; null when the term has no offering data. */
  sectionCounts: Map<CourseCode, number> | null;
  targetCredits?: number;
  maxCredits?: number;
  /**
   * False to pick only courses a program needs, or SBC courses they require;
   * SBCs then just break ties between them.
   */
  pickForSbc?: boolean;
}): SemesterProposal {
  const retakes = new Set(audit.programs.flatMap((p) => p.retakes));
  const taken = new Set(usableAttempts(student.attempts).map((a) => a.code).filter((code) => !retakes.has(code)));

  const prereqsFor = prerequisiteChecker(audit, student);
  const standingLevel = Number(standingFor(audit.credits.earned + audit.credits.inProgress).slice(1));

  // The catalog's sample sequence names the usual choice (e.g. "CSE 416 or CSE 356" lists 416 first).
  const recommended = new Set(
    audit.programs.flatMap((p) =>
      (p.program.sampleSequence ?? []).flatMap((t) => t.slots.flatMap((s) => (s.kind === "course" ? [s.code] : []))),
    ),
  );
  const { needs, review, replaced } = needsFrom(audit, courses);
  const programNeeds = needs.filter((n) => n.kind !== "sbc");
  const unlocks = unlockCounts(courses, taken, new Set(programNeeds.flatMap((n) => [...n.options])));
  const sectionsFor = (c: CourseRecord) => (sectionCounts ? (sectionCounts.get(c.code) ?? null) : null);
  const isEligible = (c: CourseRecord) => !taken.has(c.code) && !replaced.has(c.code) && prereqsFor(c).met;
  let candidates = courses.filter(isEligible);

  const score = (c: CourseRecord) => {
    const matching = needs.filter((n) => n.remaining > 0 && n.options.has(c.code));
    // Without SBC picks, an SBC course still counts when a needed course requires it (WRT 102 for CSE 300).
    if (!pickForSbc && !matching.some((n) => n.kind !== "sbc") && !unlocks.get(c.code)) return 0;
    const weights = matching
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
      Math.max(0, Math.floor(Number(c.code.split(" ")[1]) / 100) - standingLevel) * LEVEL_PENALTY -
      Number(c.code.split(" ")[1]) / 1000
    );
  };

  const byCode = new Map(courses.map((c) => [c.code, c]));
  const picked: ProposedCourse[] = [];
  let total = 0;

  /** A course plus the course it must be taken with, when that one isn't done yet. */
  const groupFor = (c: CourseRecord): CourseRecord[] | null => {
    const pairCode = pairedCorequisite(c);
    const pair = pairCode && !taken.has(pairCode) && !picked.some((p) => p.course.code === pairCode) ? byCode.get(pairCode) : null;
    if (!pair) return [c];
    return isEligible(pair) ? [c, pair] : null;
  };
  const groupCredits = (group: CourseRecord[]) => group.reduce((s, c) => s + plannedCredits(c), 0);

  const pick = (c: CourseRecord) => {
    // Within a program a course counts once (majors disallow reuse), so it fills its most
    // important program need; SBC objectives may overlap with major courses.
    const matching = needs.filter((n) => n.remaining > 0 && n.options.has(c.code));
    const programNeed = matching.filter((n) => n.kind !== "sbc").sort((a, b) => KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind])[0];
    const fills = [...(programNeed ? [programNeed] : []), ...matching.filter((n) => n.kind === "sbc")];
    fills.forEach((n) => n.remaining--);
    picked.push({
      course: c,
      fills: fills.map((n) => ({ requirementId: n.requirementId, title: n.title, kind: n.kind })),
      checks: prereqsFor(c).unverifiable,
      retake: retakes.has(c.code),
      sections: sectionsFor(c),
    });
    total += plannedCredits(c);
    candidates = candidates.filter((x) => x.code !== c.code);
  };

  while (total < targetCredits) {
    const best = candidates
      .map((c) => ({ c, s: score(c), group: groupFor(c) }))
      .filter((x) => x.s > 0 && x.group && total + groupCredits(x.group) <= maxCredits)
      .sort((a, b) => b.s - a.s)[0];
    if (!best) break;
    // Paired courses (a lecture and its lab) go into the same term.
    best.group!.forEach(pick);
  }

  const deferred = [
    ...(pickForSbc ? needs : programNeeds)
      .filter((n) => n.remaining > 0)
      .map((n) => {
        const options = courses.filter((c) => n.options.has(c.code) && !taken.has(c.code));
        const reason = options.some(isEligible)
          ? "Term is full"
          : options.length === 0
            ? "No courses found"
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
