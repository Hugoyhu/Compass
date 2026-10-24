/**
 * Plain-code parsing for the common prerequisite shapes. Anything these rules
 * don't fully recognize returns undefined and goes to the model instead.
 *
 * Handled, per ";"-separated part (parts are ANDed):
 *   "CSE 114" · "X and Y" · "X or Y" · "MAT 125 or 131" · "C or higher in X"
 *   "U3 or U4 standing" · "junior standing" · "CSE or ISE major" · "permission of instructor"
 *   "one D.E.C. F or SBS course" (a category, not a course → unparsed leaf, verbatim)
 */
import type { LetterGrade } from "@/lib/domain/catalog/common";
import type { Prereq } from "@/lib/domain/catalog/course";
import { codesIn } from "./enrollment";

const CODE = String.raw`[A-Z]{3,4} \d{3}`;
const CODE_LIST = new RegExp(String.raw`^${CODE}(?:(?:\s*,\s*|\s*,?\s+(?:and|or)\s+)(?:${CODE}|\d{3}))*$`);
const GRADE_PREFIX = /^([A-D][+-]?) or (?:higher|better) in (?:the following:\s*)?/i;
const STANDING = /^U([234])(?:\s+or\s+U[34])*(?:\s+or\s+higher)?\s+(?:standing|status)(?:\s+or\s+higher)?\.?$/i;
const STANDING_IN_WORDS = /^(sophomore|junior|senior)(?:\s+or\s+(?:junior|senior))*\s+(?:standing|status)(?:\s+or\s+higher)?$/i;
/** "one D.E.C. F or SBS course", "one HUM course": a category requirement with no specific course. */
const CATEGORY_COURSE = /^(?:one|1|two|2)\s+(?:(?:previous|additional)\s+)?(?:D\.?E\.?C\.?\s+[A-K]|[A-Z]{3,4}\+?)(?:\s+or\s+(?:D\.?E\.?C\.?\s+[A-K]|[A-Z]{3,4}\+?))*\s+courses?$/i;
const STANDING_WORDS: Record<string, "U2" | "U3" | "U4"> = { sophomore: "U2", junior: "U3", senior: "U4" };
const PROGRAM = /^[A-Z]{3}(?:(?:\s*,\s*|\s*,?\s+or\s+)[A-Z]{3})*\s+(?:major|minor)s?$/;
const PERMISSION = /^(?:permission|approval|consent) of (?:the )?(?:instructor|department|program director|undergraduate program director)$/i;

export function parseSimplePrereq(text: string): Prereq | undefined {
  const parts = text
    .replace(/\.$/, "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const parsed = parts.map(parsePart);
  if (parsed.some((p) => !p)) return undefined;
  return parsed.length === 1 ? parsed[0] : { type: "and", of: parsed as Prereq[] };
}

function parsePart(part: string): Prereq | undefined {
  const standing = part.match(STANDING);
  if (standing) return { type: "standing", level: `U${standing[1]}` as "U2" | "U3" | "U4" };
  const words = part.match(STANDING_IN_WORDS);
  if (words) return { type: "standing", level: STANDING_WORDS[words[1].toLowerCase()] };
  if (CATEGORY_COURSE.test(part)) return { type: "unparsed", text: part };
  if (PROGRAM.test(part)) return { type: "program", text: part };
  if (PERMISSION.test(part)) return { type: "permission", text: part };

  const grade = part.match(GRADE_PREFIX);
  const list = grade ? part.slice(grade[0].length) : part;
  if (!CODE_LIST.test(list)) return undefined;
  const hasAnd = /\band\b/.test(list);
  const hasOr = /\bor\b/.test(list);
  const codes = codesIn(list);
  // A bare comma list ("PHI 300, 304") is ambiguous: all of them, or any one?
  if ((hasAnd && hasOr) || (codes.length > 1 && !hasAnd && !hasOr)) return undefined;
  const minGrade = grade?.[1].toUpperCase() as LetterGrade | undefined;
  const leaves: Prereq[] = codes.map((code) => (minGrade ? { type: "course", code, minGrade } : { type: "course", code }));
  if (leaves.length === 1) return leaves[0];
  return { type: hasAnd ? "and" : "or", of: leaves };
}

/** Marks every course in a pre- or corequisite tree as takeable at the same time. */
export function allowConcurrent(tree: Prereq): Prereq {
  if (tree.type === "course") return { ...tree, concurrentAllowed: true };
  if (tree.type === "and" || tree.type === "or") return { ...tree, of: tree.of.map(allowConcurrent) };
  return tree;
}

export function hasUnparsed(tree: Prereq): boolean {
  if (tree.type === "unparsed") return true;
  if (tree.type === "and" || tree.type === "or") return tree.of.some(hasUnparsed);
  return false;
}

export function treeCodes(tree: Prereq): string[] {
  if (tree.type === "course") return [tree.code];
  if (tree.type === "and" || tree.type === "or") return tree.of.flatMap(treeCodes);
  return [];
}
