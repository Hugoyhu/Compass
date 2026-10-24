/**
 * Degree program definitions, modeled on Stony Brook Undergraduate Catalog
 * program pages (e.g. "Computer Science, BS").
 *
 * Shape: numbered requirements, each a rule tree, plus program-wide policies
 * (grades, GPA, residency), course substitutions, and display-only notes.
 */
import { z } from "zod";
import {
  CourseCodeSchema,
  LetterGradeSchema,
  ReviewSchema,
  SbcCodeSchema,
  SeasonSchema,
  SourceSchema,
  type CourseCode,
} from "./common";

// ---------------------------------------------------------------------------
// Course selectors and choice constraints
// ---------------------------------------------------------------------------

/**
 * A set of courses. A course matches if it is listed in `courses`/`ranges`, or
 * if at least one filter field is given and the course passes every filter.
 * Exclusions apply last.
 */
export const CourseSelectorSchema = z.strictObject({
  courses: z.array(CourseCodeSchema).optional(),
  ranges: z
    .array(z.strictObject({ subject: z.string(), from: z.number().int(), to: z.number().int() }))
    .optional()
    .describe('Inclusive number ranges, e.g. "CSE 360-CSE 363" → { subject: "CSE", from: 360, to: 363 }'),
  subjects: z.array(z.string()).optional(),
  minNumber: z.number().int().optional().describe("Upper-division is 300"),
  maxNumber: z.number().int().optional(),
  minCredits: z.number().optional().describe('"each of which must carry at least three credits" → 3'),
  excludeCourses: z.array(CourseCodeSchema).optional(),
  excludeAttributes: z
    .array(z.string())
    .optional()
    .describe('Course attributes to exclude, e.g. "non-technical"'),
  excludeUsedBy: z
    .array(z.string())
    .optional()
    .describe("Requirement or rule ids whose applied courses may not be reused here"),
});

export const ChooseConstraintSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("maxFrom"),
    from: CourseSelectorSchema,
    maxCourses: z.number().int().optional(),
    maxCredits: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("minFrom"),
    from: CourseSelectorSchema,
    minCourses: z.number().int(),
    countUsedBy: z
      .array(z.string())
      .optional()
      .describe("Requirement ids whose applied courses also count toward the minimum"),
  }),
  z.strictObject({
    type: z.literal("onePerGroup"),
    groups: z.array(z.array(CourseCodeSchema)),
  }),
  z.strictObject({
    type: z.literal("notEquivalentTo"),
    requirementId: z.string().describe("Chosen courses may not be equivalent to courses applied there"),
  }),
]);

export type CourseSelector = z.infer<typeof CourseSelectorSchema>;
export type ChooseConstraint = z.infer<typeof ChooseConstraintSchema>;

// ---------------------------------------------------------------------------
// Rule tree
// ---------------------------------------------------------------------------

interface RuleMeta {
  /** Stable id so policies and selectors can reference this node, e.g. "cse-bs.2.capstone". */
  id?: string;
  /** Verbatim catalog text this node was derived from. */
  sourceText?: string;
  /** A condition software can't verify (topic, approval); the audit flags it for an advisor. */
  manualCheck?: string;
  /** Display name, e.g. "Finance" for one alternative of a specialization choice. */
  label?: string;
}

/** What a student-chosen alternative is called in the catalog. */
export const ChoiceKindSchema = z.enum(["concentration", "specialization", "track"]);
export type ChoiceKind = z.infer<typeof ChoiceKindSchema>;

export type Rule = RuleMeta &
  (
    | { type: "course"; code: CourseCode }
    | { type: "allOf"; rules: Rule[] }
    | {
        type: "anyOf";
        rules: Rule[];
        /**
         * Set when the student declares one alternative (a concentration,
         * specialization, or track) rather than satisfying whichever they can.
         * The node and each alternative then have an id and a label.
         */
        choice?: ChoiceKind;
      }
    | {
        type: "choose";
        count?: number;
        credits?: number;
        from: CourseSelector;
        constraints?: ChooseConstraint[];
      }
    | { type: "unparsed"; text: string; reason: string }
  );

const ruleMeta = {
  id: z.string().optional(),
  sourceText: z.string().optional(),
  manualCheck: z.string().optional(),
  label: z.string().optional().describe('Display name for an alternative of a choice, e.g. "Finance"'),
};

const leafVariants = [
  z.strictObject({ ...ruleMeta, type: z.literal("course"), code: CourseCodeSchema }),
  z.strictObject({
    ...ruleMeta,
    type: z.literal("choose"),
    count: z.number().int().optional().describe("Number of courses to choose"),
    credits: z.number().optional().describe("Credits to choose, when stated in credits instead of courses"),
    from: CourseSelectorSchema,
    constraints: z.array(ChooseConstraintSchema).optional(),
  }),
  z.strictObject({
    ...ruleMeta,
    type: z.literal("unparsed"),
    text: z.string(),
    reason: z.string().describe("Why this could not be expressed with the other rule types"),
  }),
] as const;

export const RuleSchema: z.ZodType<Rule> = z.discriminatedUnion("type", [
  ...leafVariants,
  z.strictObject({ ...ruleMeta, type: z.literal("allOf"), rules: z.array(z.lazy(() => RuleSchema)) }),
  z.strictObject({
    ...ruleMeta,
    type: z.literal("anyOf"),
    rules: z
      .array(z.lazy(() => RuleSchema))
      .describe("Exactly one alternative must be satisfied; an alternative may be an allOf"),
    choice: ChoiceKindSchema.optional().describe(
      "Set when the student declares one alternative (concentration, specialization, track); give the node and each alternative an id and a label",
    ),
  }),
]) as z.ZodType<Rule>;

// ---------------------------------------------------------------------------
// Policies and substitutions
// ---------------------------------------------------------------------------

const appliesTo = z.array(z.string()).describe("Requirement or rule ids this policy covers");

export const PolicySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("minGrade"), grade: LetterGradeSchema, appliesTo, sourceText: z.string() }),
  z.strictObject({ type: z.literal("letterGradeRequired"), appliesTo, sourceText: z.string() }),
  z.strictObject({
    type: z.literal("minGpa"),
    gpa: z.number(),
    appliesTo: appliesTo.describe("GPA is computed across all courses applied to these requirements"),
    sourceText: z.string(),
  }),
  z.strictObject({
    type: z.literal("residencyCredits"),
    minCredits: z.number(),
    appliesTo: appliesTo.describe("At least minCredits of the courses applied here must be taken at Stony Brook"),
    sourceText: z.string(),
  }),
  z.strictObject({
    type: z.literal("residencyRequired"),
    appliesTo: appliesTo.describe("Courses applied here must be taken at Stony Brook"),
    sourceText: z.string(),
  }),
  z.strictObject({
    type: z.literal("prerequisiteGrade"),
    subjects: z.array(z.string()),
    minGrade: LetterGradeSchema,
    passNoCreditAllowed: z.boolean(),
    sourceText: z.string(),
  }),
]);

export const SubstitutionSchema = z.strictObject({
  id: z.string(),
  replaces: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("courses"), courses: z.array(CourseCodeSchema) }),
    z.strictObject({ type: z.literal("rule"), ruleId: z.string() }),
  ]),
  with: RuleSchema,
  condition: z.string().optional().describe('Who may use it, e.g. "Students pursuing Honors"'),
  requiresApproval: z.boolean().describe("True when a department or advisor must approve it"),
  sourceText: z.string(),
});

export type ProgramPolicy = z.infer<typeof PolicySchema>;
export type Substitution = z.infer<typeof SubstitutionSchema>;

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

export const SampleTermSchema = z.strictObject({
  year: z.number().int().describe("1 = freshman … 4 = senior"),
  season: SeasonSchema,
  slots: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("course"),
        code: CourseCodeSchema,
        alternatives: z.array(CourseCodeSchema).optional().describe('"CSE 416 or CSE 356" → code CSE 416, alternatives [CSE 356]'),
        credits: z.number(),
      }),
      z.strictObject({
        kind: z.literal("placeholder"),
        label: z.string().describe('e.g. "UD Technical Elective 3", "SBC", "Natural Science Course + Lab"'),
        credits: z.number(),
      }),
    ]),
  ),
});

export const NoteSchema = z.strictObject({
  topic: z.enum(["admission", "advising", "grading", "sbc", "other"]),
  text: z.string(),
});

export const ProgramDefinitionSchema = z.strictObject({
  id: z.string().describe('Slug, e.g. "cse-bs"'),
  name: z.string().describe('As printed, e.g. "Computer Science, BS"'),
  kind: z
    .enum(["major", "minor", "program"])
    .describe("program: a special academic program taken alongside a major, e.g. the Honors College"),
  degree: z.string().optional().describe('e.g. "Bachelor of Science in Computer Science"'),
  source: SourceSchema,
  review: ReviewSchema,
  approxCredits: z.number().optional(),
  allowCourseReuse: z
    .boolean()
    .describe("Whether one course may count toward two requirements of this program (false for majors unless stated)"),
  requirements: z.array(
    z.strictObject({
      id: z.string().describe('"<program id>.<item number>", e.g. "cse-bs.3"'),
      label: z.string().describe('Item number as printed, e.g. "3"'),
      title: z.string(),
      rule: RuleSchema,
      sourceText: z.string(),
    }),
  ),
  policies: z.array(PolicySchema),
  substitutions: z.array(SubstitutionSchema),
  sbc: z.strictObject({
    exemptions: z.array(z.strictObject({ category: SbcCodeSchema, reason: z.string() })),
    fulfillment: z
      .array(z.strictObject({ category: SbcCodeSchema, rule: RuleSchema, sourceText: z.string() }))
      .describe("Only program-specific SBC rules stated on the page; per-course SBC tags live on course records"),
  }),
  sampleSequence: z.array(SampleTermSchema).optional(),
  notes: z.array(NoteSchema).describe("Displayed to students, never evaluated"),
});

/** What the extractor asks the model for: `source` and `review` are set by the pipeline. */
export const ProgramExtractionSchema = ProgramDefinitionSchema.omit({ source: true, review: true });

export type ExtractedProgram = z.infer<typeof ProgramExtractionSchema>;

export type ProgramDefinition = z.infer<typeof ProgramDefinitionSchema>;
export type ProgramRequirement = ProgramDefinition["requirements"][number];
export type SampleTerm = z.infer<typeof SampleTermSchema>;
