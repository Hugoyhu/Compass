/**
 * Professor ratings from Rate My Professors, one record per rated Stony Brook
 * professor. Written by utilities/scrapers/ratemyprofessors to
 * data/catalog/professors.json. Ratings are student opinions, not catalog data.
 */
import { z } from "zod";
import { SourceSchema } from "./common";

export const ProfessorRatingSchema = z.strictObject({
  /** Rate My Professors' id, for linking to the professor's page. */
  id: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  department: z.string(),
  /** 1–5 */
  rating: z.number(),
  /** 1–5, higher is harder */
  difficulty: z.number(),
  numRatings: z.number(),
  /** 0–100; null when too few ratings answered it */
  wouldTakeAgain: z.number().nullable(),
});

export const ProfessorRatingsFileSchema = z.strictObject({
  source: SourceSchema,
  professors: z.array(ProfessorRatingSchema),
});

export type ProfessorRating = z.infer<typeof ProfessorRatingSchema>;
