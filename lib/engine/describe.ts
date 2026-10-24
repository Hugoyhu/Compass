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
