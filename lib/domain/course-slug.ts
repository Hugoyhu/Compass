import type { CourseCode } from "./types";

/** "CSE 214" → "CSE-214", for URLs. */
export function slugFor(code: CourseCode): string {
  return code.replace(" ", "-");
}

/** "CSE-214" (or "cse-214") → "CSE 214". */
export function codeFromSlug(slug: string): CourseCode {
  return decodeURIComponent(slug).replace("-", " ").toUpperCase();
}
