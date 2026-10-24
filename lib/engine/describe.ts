import type { CourseSelector } from "@/lib/domain/catalog/program";
import type { MissingItem, PolicyStatus, RequirementResult, RequirementStatus } from "./audit";

export const STATUS_LABELS: Record<RequirementStatus | "exempt", string> = {
  satisfied: "Satisfied",
  "in-progress": "In progress",
  partial: "Partially met",
  "not-started": "Not started",
  "needs-review": "Needs review",
  exempt: "Exempt",
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
  if (result.status === "in-progress") return "Will be satisfied once in-progress courses are completed";
  const pending =
    result.inProgress > 0
      ? ` (${result.inProgress} ${result.inProgress === 1 ? result.unit.slice(0, -1) : result.unit} in progress)`
      : "";
  return `Still needed: ${result.missing.map(describeMissing).join("; ")}${pending}`;
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
