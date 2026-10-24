/**
 * Course records as published in the Stony Brook Undergraduate Catalog.
 *
 * `prerequisiteText` is always kept verbatim; `prerequisites` is the parsed
 * tree and may be missing or partially `unparsed`. Like program rules, the
 * tree is recursive, so `prereqSchemaWithDepth(n)` exists for LLM extraction.
 */
import { z } from "zod";
import {
  CourseCodeSchema,
  LetterGradeSchema,
  SbcCodeSchema,
  SeasonSchema,
  SourceSchema,
  type CourseCode,
  type LetterGrade,
} from "./common";

export type Prereq =
  | { type: "course"; code: CourseCode; minGrade?: LetterGrade; concurrentAllowed?: boolean }
  | { type: "standing"; level: "U2" | "U3" | "U4" }
  | { type: "program"; text: string }
  | { type: "permission"; text: string }
  | { type: "and"; of: Prereq[] }
  | { type: "or"; of: Prereq[] }
  | { type: "unparsed"; text: string };

const prereqLeaves = [
  z.strictObject({
    type: z.literal("course"),
    code: CourseCodeSchema,
    minGrade: LetterGradeSchema.optional(),
    concurrentAllowed: z.boolean().optional().describe('"may be taken concurrently" → true'),
  }),
  z.strictObject({ type: z.literal("standing"), level: z.enum(["U2", "U3", "U4"]) }),
  z.strictObject({
    type: z.literal("program"),
    text: z.string().describe('Major/minor/admission restriction, e.g. "CSE major"'),
  }),
  z.strictObject({ type: z.literal("permission"), text: z.string() }),
  z.strictObject({ type: z.literal("unparsed"), text: z.string() }),
] as const;

function makePrereqSchema(child: z.ZodType<Prereq> | null): z.ZodType<Prereq> {
  if (!child) return z.discriminatedUnion("type", [...prereqLeaves]) as z.ZodType<Prereq>;
  return z.discriminatedUnion("type", [
    ...prereqLeaves,
    z.strictObject({ type: z.literal("and"), of: z.array(child) }),
    z.strictObject({ type: z.literal("or"), of: z.array(child) }),
  ]) as z.ZodType<Prereq>;
}

export const PrereqSchema: z.ZodType<Prereq> = makePrereqSchema(z.lazy(() => PrereqSchema));

export function prereqSchemaWithDepth(depth: number): z.ZodType<Prereq> {
  return makePrereqSchema(depth <= 0 ? null : prereqSchemaWithDepth(depth - 1));
}

function makeCourseSchema(prereq: z.ZodType<Prereq>) {
  return z.strictObject({
    code: CourseCodeSchema,
    title: z.string(),
    credits: z
      .strictObject({ min: z.number(), max: z.number() })
      .describe('"3 credits" → {min: 3, max: 3}; "0-3 credits" → {min: 0, max: 3}'),
    description: z.string(),
    sbc: z.array(
      z.strictObject({
        category: SbcCodeSchema,
        partial: z.boolean().optional().describe('"(partial fulfillment)" → true'),
      }),
    ),
    prerequisiteText: z.string().optional(),
    prerequisites: prereq.optional(),
    corequisiteText: z.string().optional(),
    advisoryText: z
      .string()
      .optional()
      .describe("Advisory prerequisites or corequisites: recommended, never enforced"),
    sbcMinGrade: LetterGradeSchema.optional().describe(
      'Lowest grade that still satisfies the course\'s SBC categories, e.g. "A through C" → "C"',
    ),
    equivalents: z
      .array(CourseCodeSchema)
      .describe('"Not for credit in addition to X" and cross-listings: courses that cannot both count'),
    attributes: z
      .array(z.string())
      .describe('Flags the audit relies on, e.g. "non-technical", "honors", "lab"'),
    typicallyOffered: z.array(SeasonSchema).optional().describe("Only when the catalog states it"),
    source: SourceSchema,
  });
}

export const CourseRecordSchema = makeCourseSchema(PrereqSchema);

export function courseExtractionSchema(depth = 3) {
  return makeCourseSchema(prereqSchemaWithDepth(depth));
}

export type CourseRecord = z.infer<typeof CourseRecordSchema>;
