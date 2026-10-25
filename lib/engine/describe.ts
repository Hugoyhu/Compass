import type { ChoiceKind, CourseSelector, ProgramDefinition, ProgramPolicy, Rule, Substitution } from "@/lib/domain/catalog/program";
import type { MissingItem, PolicyStatus, RequirementResult, RequirementStatus } from "./audit";

export const STATUS_LABELS: Record<RequirementStatus | "exempt" | "not-required", string> = {
  satisfied: "Satisfied",
  "in-progress": "In progress",
  partial: "Partially met",
  "not-started": "Not started",
  "needs-review": "Needs review",
  exempt: "Exempt",
  "not-required": "Not needed",
};

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  satisfied: "Met",
  "in-progress": "On track",
  "not-met": "Not met",
  pending: "Pending",
  info: "Note",
};

export const POLICY_TITLES: Record<string, string> = {
  minGrade: "Minimum grade",
  letterGradeRequired: "Letter grades",
  minGpa: "GPA minimum",
  residencyCredits: "Credits at Stony Brook",
  residencyRequired: "Must be taken at Stony Brook",
  prerequisiteGrade: "Prerequisite grades",
};

export const NOTE_TOPICS: Record<string, string> = {
  admission: "Admission",
  advising: "Advising",
  grading: "Grading",
  sbc: "SBC",
  other: "Note",
};

/**
 * The printed item number ("1", "2a", "A"), or null when the label is an
 * extractor-made slug like "chem-lecture" that shouldn't be shown.
 */
export function itemNumber(label: string): string | null {
  return /^[0-9A-Za-z]{1,3}(\.[0-9A-Za-z]{1,3})?\.?$/.test(label) ? label.replace(/\.$/, "") : null;
}

/** "3. Computer Science Electives", or just the title when there's no item number. */
export function requirementHeading(req: { label: string; title: string }): string {
  const n = itemNumber(req.label);
  return n ? `${n}. ${req.title}` : req.title;
}

/** Short description of a course pool, e.g. "upper-division CSE courses". */
export function describeSelector(sel: CourseSelector): string {
  const parts: string[] = [];
  if (sel.subjects?.length) {
    const level = sel.minNumber && sel.minNumber >= 300 ? "upper-division " : "";
    parts.push(`${level}${sel.subjects.join("/")} courses`);
  }
  if (sel.courses?.length && !sel.subjects?.length) {
    parts.push(sel.courses.length <= 4 ? sel.courses.join(", ") : `the ${sel.courses.length} listed courses`);
  }
  sel.ranges?.forEach((r) => parts.push(`${r.subject} ${r.from}–${r.to}`));
  return parts.join(" or ") || "the listed courses";
}

/** True when every course a pool can take is 300-level or above, so its courses count as upper-division credit. */
export function isUpperDivisionPool(sel: CourseSelector): boolean {
  const ranges = sel.ranges ?? [];
  const courses = sel.courses ?? [];
  const upper = ranges.every((r) => r.from >= 300) && courses.every((c) => Number(c.split(" ")[1]) >= 300);
  if (sel.subjects?.length || sel.minNumber !== undefined) return upper && (sel.minNumber ?? 0) >= 300;
  return upper && (ranges.length > 0 || courses.length > 0);
}

export function describeMissing(item: MissingItem): string {
  switch (item.kind) {
    case "course":
      return item.options.join(" or ");
    case "choose": {
      const noun = item.unit === "credits" ? "credits" : item.remaining === 1 ? "course" : "courses";
      return `${item.remaining} more ${noun} from ${describeSelector(item.pool)}`;
    }
    case "review":
      return `Advisor review: ${item.text}`;
  }
}

/** Plain-language summary of what is still needed for a requirement. */
export function describeRemaining(result: RequirementResult): string {
  if (result.status === "satisfied") return "Complete";
  if (result.status === "in-progress") return "Done once current courses finish";
  const pending =
    result.inProgress > 0
      ? ` (${result.inProgress} ${result.inProgress === 1 ? result.unit.slice(0, -1) : result.unit} in progress)`
      : "";
  return `Needs ${result.missing.map(describeMissing).join("; ")}${pending}`;
}

/** 0–1 fractions for completed and in-progress portions of a requirement. */
export function progressFractions(result: Pick<RequirementResult, "completed" | "inProgress" | "required">): {
  completed: number;
  inProgress: number;
} {
  if (result.required === 0) return { completed: 1, inProgress: 0 };
  const completed = Math.min(1, result.completed / result.required);
  const inProgress = Math.min(1 - completed, result.inProgress / result.required);
  return { completed, inProgress };
}

/**
 * Requirement ids, and ids of rules nested inside them, → how to refer to the
 * requirement: "requirement 3 (Title)" in full, "3" in a short list. Slug labels
 * aren't shown, so those requirements are referred to by title.
 */
export function requirementRefs(program: ProgramDefinition): { full: Record<string, string>; short: Record<string, string> } {
  const full: Record<string, string> = {};
  const short: Record<string, string> = {};
  const visit = (rule: Rule, id: string) => {
    if (rule.id && !(rule.id in full)) {
      full[rule.id] = full[id];
      short[rule.id] = short[id];
    }
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => visit(r, id));
  };
  for (const r of program.requirements) {
    const n = itemNumber(r.label);
    full[r.id] = n ? `requirement ${n} (${r.title})` : `“${r.title}”`;
    short[r.id] = n ?? `“${r.title}”`;
    visit(r.rule, r.id);
  }
  return { full, short };
}

export function describePolicy(p: ProgramPolicy, shortRefs: Record<string, string>): string {
  const ids = "appliesTo" in p ? p.appliesTo : [];
  const names = ids.map((id) => shortRefs[id] ?? id);
  const numbered = ids.every((id) => shortRefs[id] && !shortRefs[id].startsWith("“"));
  const scope =
    names.length === 0 ? "" : numbered ? ` in ${names.length === 1 ? "requirement" : "requirements"} ${names.join(", ")}` : ` in ${names.join(", ")}`;
  switch (p.type) {
    case "minGrade":
      return `${p.grade} or higher${scope}.`;
    case "letterGradeRequired":
      return `Courses${scope} must be taken for a letter grade.`;
    case "minGpa":
      return `${p.gpa.toFixed(2)} GPA or higher${scope}.`;
    case "residencyCredits":
      return `At least ${p.minCredits} credits${scope} must be taken at Stony Brook.`;
    case "residencyRequired":
      return `Courses${scope} must be taken at Stony Brook.`;
    case "prerequisiteGrade":
      return `${p.minGrade} or higher in ${p.subjects.join("/")} prerequisites${p.passNoCreditAllowed ? "" : "; no Pass/No Credit"}.`;
  }
}

/**
 * Attaches each substitution to every requirement it changes (one that names a
 * replaced course or contains the replaced rule). Substitutions in `skip` (shown
 * elsewhere, e.g. as alternative paths) are left out; ones matching nothing
 * are returned as unattached.
 */
export function attachSubstitutions(
  program: ProgramDefinition,
  skip: Set<string>,
): { byRequirement: Map<string, Substitution[]>; unattached: Substitution[] } {
  const byRequirement = new Map<string, Substitution[]>();
  const unattached: Substitution[] = [];
  const contents = program.requirements.map((r) => {
    const codes = new Set<string>();
    const ids = new Set<string>([r.id]);
    const visit = (rule: Rule) => {
      if (rule.id) ids.add(rule.id);
      if (rule.type === "course") codes.add(rule.code);
      if (rule.type === "choose") rule.from.courses?.forEach((c) => codes.add(c));
      if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
    };
    visit(r.rule);
    return { id: r.id, codes, ids };
  });
  for (const sub of program.substitutions) {
    if (skip.has(sub.id)) continue;
    const targets = contents.filter(({ codes, ids }) =>
      sub.replaces.type === "courses" ? sub.replaces.courses.some((c) => codes.has(c)) : ids.has(sub.replaces.ruleId),
    );
    if (targets.length === 0) unattached.push(sub);
    targets.forEach(({ id }) => byRequirement.set(id, [...(byRequirement.get(id) ?? []), sub]));
  }
  return { byRequirement, unattached };
}

export interface ProgramChoice {
  /** The choice rule's id, the key in StudentRecord.choices. */
  id: string;
  kind: ChoiceKind;
  options: { id: string; label: string }[];
}

/** Concentrations, specializations, and tracks a rule asks the student to choose. */
export function choicesIn(rule: Rule): ProgramChoice[] {
  if (rule.type === "anyOf" && rule.choice && rule.id) {
    return [
      {
        id: rule.id,
        kind: rule.choice,
        options: rule.rules.flatMap((alt, i) => (alt.id ? [{ id: alt.id, label: alt.label ?? `Option ${i + 1}` }] : [])),
      },
    ];
  }
  return rule.type === "allOf" || rule.type === "anyOf" ? rule.rules.flatMap(choicesIn) : [];
}
