/**
 * Shared primitives for catalog data (courses and programs).
 *
 * Every object is strict (no unknown keys) because Claude structured outputs
 * require `additionalProperties: false`, and because silent extra fields in
 * extracted data usually mean the extractor misunderstood something.
 */
import { z } from "zod";

/** "CSE 214" — three or four capital letters, a space, three digits. */
export const CourseCodeSchema = z
  .string()
  .regex(/^[A-Z]{3,4} \d{3}$/, 'Course codes look like "CSE 214"');

export const LetterGradeSchema = z.enum(["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"]);

export const SeasonSchema = z.enum(["Fall", "Winter", "Spring", "Summer"]);

/** Stony Brook Curriculum learning objectives, including the upper-tier "+" categories. */
export const SbcCodeSchema = z.enum([
  "ARTS", "GLO", "HUM", "LANG", "QPS", "SBS", "SNW", "TECH", "USA", "WRT",
  "STAS",
  "EXP+", "HFA+", "SBS+", "STEM+",
  "CER", "DIV", "ESI", "SPK", "WRTD",
]);

/** Where a record came from. Required on everything so the UI never overstates currency. */
export const SourceSchema = z.strictObject({
  catalog: z.string().describe('Catalog edition, e.g. "Fall 2026 Undergraduate Catalog"'),
  url: z.string(),
  fetchedAt: z.string().describe("ISO date the page was fetched"),
});

export const ReviewSchema = z.strictObject({
  status: z.enum(["draft", "reviewed"]),
  extractedBy: z.string().describe('"hand" or the extractor/model that produced the record'),
  reviewedBy: z.string().optional(),
});

export type CourseCode = z.infer<typeof CourseCodeSchema>;
export type LetterGrade = z.infer<typeof LetterGradeSchema>;
export type Season = z.infer<typeof SeasonSchema>;
export type SbcCode = z.infer<typeof SbcCodeSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Review = z.infer<typeof ReviewSchema>;
