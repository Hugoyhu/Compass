/**
 * Splits a PeopleSoft course page's text blob into its labeled parts.
 *
 * The blob runs: "... Enrollment Information Enrollment Requirement <requirement
 * text> Requirement Designation <old DEC code, required grade> Course Attribute
 * <SBC attributes> Description <description> Return to Browse Course Catalog ...".
 * Each part is optional. The requirement text is further split on labels such
 * as "Prerequisite:" and "Advisory Corequisite:".
 */
import type { CourseCode, LetterGrade, SbcCode } from "@/lib/domain/catalog/common";
import { LetterGradeSchema } from "@/lib/domain/catalog/common";

export type RequirementKind = "prereq" | "preco" | "coreq" | "advisory" | "anti";

export interface RequirementSegment {
  kind: RequirementKind;
  /** The label as printed, e.g. "Pre- or Corequisite:". */
  label: string;
  text: string;
}

export interface EnrollmentParts {
  /** Labeled requirement segments in page order. */
  segments: RequirementSegment[];
  /** Requirement text before the first label, if any. */
  unlabeled?: string;
  designation?: string;
  attributes?: string;
}

// Order matters where labels overlap: "Advisory Prerequisite" before "Prerequisite",
// "Pre- or Corequisite" before both "Prerequisite" and "Corequisite".
const LABEL_PATTERNS: [RequirementKind, string][] = [
  ["advisory", String.raw`Advisory\s+(?:Pre-?\s*or\s*Co-?\s*requisites?|Prereq(?:uisites?|uiste)?(?:\(s\))?|Co-?\s*requisites?(?:\(s\))?)`],
  ["preco", String.raw`(?:Pre-?\s*or\s*Co-?\s*requisites?|Prerequisites?\s+or\s+Corequisites?)(?:\(s\))?`],
  ["anti", String.raw`Anti-?\s*requisites?`],
  ["coreq", String.raw`(?:Mandatory\s+)?Co-?\s*requisites?(?:\(s\))?`],
  ["prereq", String.raw`Prerequisites?(?:\(s\))?`],
];
const LABEL_RE = new RegExp(LABEL_PATTERNS.map(([kind, p]) => `(?<${kind}>\\b${p}\\s*:)`).join("|"), "gi");

/** Cuts the page text into requirement, designation, and attribute parts. */
export function splitPageText(pageText: string, description: string): EnrollmentParts {
  const start = pageText.indexOf("Enrollment Information");
  if (start < 0) return { segments: [] };
  // End at the real description; the word "Description" can't be trusted alone.
  const descStart = description ? pageText.indexOf(` Description ${description.slice(0, 40)}`, start) : -1;
  const end = descStart >= 0 ? descStart : pageText.indexOf(" Description ", start);
  const block = pageText.slice(start + "Enrollment Information".length, end >= 0 ? end : undefined);

  const attrAt = block.indexOf("Course Attribute");
  const desigAt = block.indexOf("Requirement Designation");
  const reqAt = block.indexOf("Enrollment Requirement");
  const cut = (from: number, label: string, ...ends: number[]) => {
    if (from < 0) return undefined;
    const stop = Math.min(...ends.filter((e) => e > from), block.length);
    return block.slice(from + label.length, stop).trim() || undefined;
  };
  const requirement = cut(reqAt, "Enrollment Requirement", desigAt, attrAt);
  return {
    ...splitRequirement(requirement ?? ""),
    designation: cut(desigAt, "Requirement Designation", attrAt),
    attributes: cut(attrAt, "Course Attribute"),
  };
}

function splitRequirement(text: string): Pick<EnrollmentParts, "segments" | "unlabeled"> {
  const matches = [...text.matchAll(LABEL_RE)];
  const segments: RequirementSegment[] = matches.map((m, i) => {
    const kind = LABEL_PATTERNS.find(([k]) => m.groups?.[k])![0];
    const next = matches[i + 1]?.index ?? text.length;
    return { kind, label: m[0], text: tidy(text.slice(m.index! + m[0].length, next)) };
  });
  const unlabeled = tidy(text.slice(0, matches[0]?.index ?? text.length));
  return { segments: segments.filter((s) => s.text), unlabeled: unlabeled || undefined };
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "Required grade: A through C" → "C". */
export function sbcMinGrade(designation: string | undefined): LetterGrade | undefined {
  const match = designation?.match(/Required grade:\s*A through ([A-D][+-]?)/i);
  const parsed = LetterGradeSchema.safeParse(match?.[1]?.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

// Longer codes first so WRTD wins over WRT and SBS+ over SBS.
const SBC_CODES: SbcCode[] = [
  "WRTD", "STEM+", "EXP+", "HFA+", "SBS+", "ARTS", "LANG", "STAS", "TECH",
  "GLO", "HUM", "QPS", "SBS", "SNW", "USA", "WRT", "CER", "DIV", "ESI", "SPK",
];
const SBC_RE = new RegExp(
  `(?<![A-Za-z+_])(${SBC_CODES.map((c) => c.replace("+", "\\+")).join("|")})(_PART)?(?![A-Za-z+])`,
  "g",
);

/** SBC tags from the attribute text, e.g. "Controlled Access TECH Understand Technology" → TECH. */
export function sbcTags(attributes: string | undefined): { category: SbcCode; partial?: boolean }[] {
  const tags = new Map<SbcCode, boolean>();
  for (const m of attributes?.matchAll(SBC_RE) ?? []) {
    const code = m[1] as SbcCode;
    tags.set(code, (tags.get(code) ?? true) && Boolean(m[2]));
  }
  return [...tags].map(([category, partial]) => (partial ? { category, partial } : { category }));
}

const CODE_OR_NUMBER = /\b((?:[A-Z]{3,4}\/)*[A-Z]{3,4})\s?(\d{3})\b|\b(\d{3})\b/g;

/**
 * Course codes in a phrase, expanding numbers whose subject is left out:
 * "PHI 300, 304, 306" → PHI 300, PHI 304, PHI 306. Cross-listings expand to
 * every subject: "ENS/PHY 119" → ENS 119, PHY 119.
 */
export function codesIn(text: string): CourseCode[] {
  const codes: CourseCode[] = [];
  let subjects: string[] = [];
  for (const m of text.matchAll(CODE_OR_NUMBER)) {
    if (m[1]) subjects = m[1].split("/");
    const number = m[2] ?? m[3];
    // A bare number continues only the last subject: "ENS/PHY 119 or 121" → PHY 121.
    const forNumber = m[1] ? subjects : subjects.slice(-1);
    codes.push(...forNumber.map((subject) => `${subject} ${number}`));
  }
  return [...new Set(codes)];
}

/**
 * Courses that can't both count: "Not for credit in addition to X",
 * "offered as both X and Y", and anti-requisites. Excludes the course itself.
 */
export function equivalents(self: CourseCode, description: string, anti: string[]): CourseCode[] {
  const phrases = [
    ...[...description.matchAll(/Not for credit in addition to ([^.]*)/gi)].map((m) => m[1]),
    ...[...description.matchAll(/offered as both ([^.]*)/gi)].map((m) => m[1]),
    ...anti,
  ];
  return [...new Set(phrases.flatMap(codesIn))].filter((c) => c !== self).sort();
}

/** The description wording the catalog uses for courses that don't count as technical electives. */
export function isNonTechnical(description: string): boolean {
  return /(cannot be used as|not counted as) a technical elective|non-?technical/i.test(description);
}
