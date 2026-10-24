/**
 * Reads and validates catalog JSON from data/catalog. Used by the file-based
 * repository and by scripts/db-load.ts, so both see exactly the same data.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CourseRecordSchema, type CourseRecord } from "@/lib/domain/catalog/course";
import { ProfessorRatingsFileSchema, type ProfessorRating } from "@/lib/domain/catalog/professor";
import { OfferingTermSchema, type OfferingTerm } from "@/lib/domain/catalog/offering";
import { ProgramDefinitionSchema, type ProgramDefinition } from "@/lib/domain/catalog/program";

const CATALOG_DIR = path.join(process.cwd(), "data/catalog");

function jsonFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

export function loadProgramFiles(): ProgramDefinition[] {
  const dir = path.join(CATALOG_DIR, "programs");
  const programs: ProgramDefinition[] = [];
  for (const file of jsonFiles(dir)) {
    const parsed = ProgramDefinitionSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    // An invalid draft must not take the app down; validate:catalog reports details.
    if (parsed.success) programs.push(parsed.data);
    else console.warn(`[catalog] Skipping invalid program file ${file}`);
  }
  return programs;
}

/** Course codes are keys throughout the app, so a code listed twice keeps its first record. */
function uniqueByCode(courses: CourseRecord[]): CourseRecord[] {
  const seen = new Set<string>();
  const unique = courses.filter((c) => !seen.has(c.code) && seen.add(c.code));
  if (unique.length < courses.length) {
    console.warn(`[catalog] courses.json lists ${courses.length - unique.length} course codes more than once; keeping the first of each`);
  }
  return unique;
}

/** Courses from courses.json. A missing or invalid file yields no courses rather than taking the app down. */
export function loadCourseFiles(): CourseRecord[] {
  const file = path.join(CATALOG_DIR, "courses.json");
  if (!existsSync(file)) {
    console.warn("[catalog] data/catalog/courses.json is missing; run npm run import:courses");
    return [];
  }
  const parsed = z.array(CourseRecordSchema).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (parsed.success) return uniqueByCode(parsed.data);
  console.warn("[catalog] data/catalog/courses.json is invalid; run npm run validate:catalog");
  return [];
}

export function loadOfferingFiles(): OfferingTerm[] {
  const dir = path.join(CATALOG_DIR, "offerings");
  const terms: OfferingTerm[] = [];
  for (const file of jsonFiles(dir)) {
    const parsed = OfferingTermSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    if (parsed.success) terms.push(parsed.data);
    else console.warn(`[catalog] Skipping invalid offerings file ${file}`);
  }
  return terms;
}

/** Professor ratings from professors.json; none when the file hasn't been scraped yet. */
export function loadProfessorRatings(): ProfessorRating[] {
  const file = path.join(CATALOG_DIR, "professors.json");
  if (!existsSync(file)) return [];
  const parsed = ProfessorRatingsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (parsed.success) return parsed.data.professors;
  console.warn("[catalog] data/catalog/professors.json is invalid; run npm run scrape:ratings");
  return [];
}
