/**
 * Class sections offered in one term, from the PeopleSoft class search.
 *
 * One file per term in data/catalog/offerings/<term>.json. Sections at the
 * SUNY Korea campus are kept but marked, so they never count as main-campus
 * offerings.
 */
import { z } from "zod";
import { CourseCodeSchema, SourceSchema } from "./common";

/**
 * "2027-SP": year, then SP (Spring), SU (Summer), FA (Fall), or WI (Winter).
 * Typed like `TermId` in lib/domain/types.ts so the two are interchangeable.
 */
export const TermIdSchema = z
  .string()
  .regex(/^\d{4}-(SP|SU|FA|WI)$/, 'Term ids look like "2027-SP"') as unknown as z.ZodType<
  `${number}-${"FA" | "WI" | "SP" | "SU"}`
>;

export const MeetingSchema = z.strictObject({
  days: z.string().describe('e.g. "MoWe"; "TBA" when unscheduled'),
  start: z.string().describe('e.g. "9:30AM"'),
  end: z.string(),
  room: z.string(),
  instructor: z.string(),
  startDate: z.string().describe("ISO date"),
  endDate: z.string().describe("ISO date"),
});

export const SectionSchema = z.strictObject({
  code: CourseCodeSchema,
  section: z.string().describe('e.g. "30" or "R30"'),
  component: z.string().describe('e.g. "LEC", "REC", "LAB"'),
  classNumber: z.string(),
  session: z.string(),
  campus: z.enum(["main", "korea"]),
  meetings: z.array(MeetingSchema),
});

export const OfferingTermSchema = z.strictObject({
  term: TermIdSchema,
  source: SourceSchema,
  sections: z.array(SectionSchema),
});

export type Meeting = z.infer<typeof MeetingSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type OfferingTerm = z.infer<typeof OfferingTermSchema>;
