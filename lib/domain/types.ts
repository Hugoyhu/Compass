/**
 * Student-side domain types. Catalog types (courses, programs, rules) live in
 * `lib/domain/catalog`, defined by Zod schemas shared with the scrapers.
 * Keep this file free of React and framework imports.
 */
import type { CourseCode, LetterGrade, SbcCode, Season } from "./catalog/common";

export type { CourseCode, LetterGrade, SbcCode, Season };

/** Canonical term identifier, e.g. "2026-FA". */
export type TermId = `${number}-${"FA" | "WI" | "SP" | "SU"}`;

export interface SbcCategory {
  code: SbcCode;
  name: string;
}

// ---------------------------------------------------------------------------
// Student record
// ---------------------------------------------------------------------------

/**
 * Grades as they appear on a record. "P" = pass, "T" = transfer/AP credit,
 * "NC" = no credit, "W" = withdrawn, "I" = incomplete.
 */
export type Grade = LetterGrade | "P" | "T" | "NC" | "W" | "I";

export type CreditSource = "sbu" | "transfer" | "ap";

export interface CourseAttempt {
  code: CourseCode;
  source: CreditSource;
  /** Term taken at SBU; omitted for AP and some transfer credit. */
  term?: TermId;
  /** Omitted while the course is in progress. */
  grade?: Grade;
  status: "completed" | "in-progress";
  /** Credits awarded; defaults to the catalog credit value. */
  credits?: number;
  /** For transfer/AP credit: where it came from. */
  origin?: string;
  /** Title as printed on the transcript; used when the catalog lacks the course. */
  title?: string;
  /** SBC designations printed on the transcript; supplement the catalog's tags. */
  sbc?: SbcCode[];
}

export interface StudentRecord {
  id: string;
  name: string;
  entryTerm: TermId;
  currentTerm: TermId;
  /** Ids of the student's majors and minors (ProgramDefinition ids). */
  programIds: string[];
  attempts: CourseAttempt[];
  /** Future terms the student intends to take, in order. */
  plan: PlannedTerm[];
  /** The fewest credits the student wants in a fall or spring term; defaults to full time (12). */
  minTermCredits?: number;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** A planned course, or a placeholder for a free elective of some number of credits. */
export type PlanItem = { code: CourseCode } | { elective: number };

export interface PlannedTerm {
  term: TermId;
  items: PlanItem[];
}

/** Programs (majors, minors, honors programs, …) a student can track at once. */
export const MAX_PROGRAMS = 8;
