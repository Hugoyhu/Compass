import { formatTerm, makeTerm, termOrdinal } from "@/lib/domain/terms";
import type { CourseAttempt, CreditSource, Grade, Season, TermId } from "@/lib/domain/types";

export interface CourseOption {
  code: string;
  title: string;
  credits: number;
}

export interface ProgramOption {
  id: string;
  name: string;
  kind: "major" | "minor";
}

/** Default "current term" for new records; students can change it. */
export const DEFAULT_CURRENT_TERM: TermId = "2026-FA";

const SEASONS: Season[] = ["Winter", "Spring", "Summer", "Fall"];
export const TERM_OPTIONS: { value: TermId; label: string }[] = [];
for (let year = 2028; year >= 2020; year--) {
  for (const season of [...SEASONS].reverse()) {
    const value = makeTerm(season, year);
    TERM_OPTIONS.push({ value, label: formatTerm(value) });
  }
}

export const GRADE_OPTIONS: Grade[] = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F", "P", "NC", "W", "I", "T"];

export const SOURCE_LABELS: Record<CreditSource, string> = {
  sbu: "Stony Brook",
  ap: "AP / exam credit",
  transfer: "Transfer credit",
};

export const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** Groups attempts for display: exam credit, transfer credit, then terms newest first. */
export function groupAttempts(attempts: CourseAttempt[]): { key: string; label: string; items: { attempt: CourseAttempt; index: number }[] }[] {
  const groups = new Map<string, { key: string; label: string; order: number; items: { attempt: CourseAttempt; index: number }[] }>();
  attempts.forEach((attempt, index) => {
    const key = attempt.source === "sbu" ? (attempt.term ?? "no-term") : attempt.source;
    const label =
      attempt.source === "sbu" ? (attempt.term ? formatTerm(attempt.term) : "Stony Brook (no term)") : SOURCE_LABELS[attempt.source];
    const order = attempt.source === "ap" ? 1e9 : attempt.source === "transfer" ? 1e9 - 1 : attempt.term ? termOrdinal(attempt.term) : 0;
    if (!groups.has(key)) groups.set(key, { key, label, order, items: [] });
    groups.get(key)!.items.push({ attempt, index });
  });
  return [...groups.values()].sort((a, b) => b.order - a.order);
}

/** Earliest Stony Brook term on the record, or the current term. */
export function entryTermFor(attempts: CourseAttempt[], currentTerm: TermId): TermId {
  const terms = attempts.filter((a) => a.source === "sbu" && a.term).map((a) => a.term!);
  return terms.sort((a, b) => termOrdinal(a) - termOrdinal(b))[0] ?? currentTerm;
}

/** Best-effort match from a transcript plan ("Computer Science Major") to a program id. */
export function matchProgram(plan: string | null, programs: ProgramOption[]): string | undefined {
  if (!plan) return undefined;
  const kind = /minor/i.test(plan) ? "minor" : "major";
  const base = plan.replace(/\b(major|minor|program|plan)\b/gi, "").trim().toLowerCase();
  return programs.find((p) => p.kind === kind && p.name.split(",")[0].trim().toLowerCase() === base)?.id;
}

/** Same course in the same term (or same exam/transfer credit) counts as a duplicate when merging. */
export function attemptKey(a: CourseAttempt): string {
  return `${a.code}|${a.source}|${a.term ?? ""}`;
}
