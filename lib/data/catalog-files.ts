/**
 * Reads and validates catalog JSON from data/catalog. Used by the file-based
 * repository and by scripts/db-load.ts, so both see exactly the same data.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CourseRecordSchema, type CourseRecord } from "@/lib/domain/catalog/course";
import { OfferingTermSchema, type OfferingTerm } from "@/lib/domain/catalog/offering";
import { ProgramDefinitionSchema, type ProgramDefinition } from "@/lib/domain/catalog/program";
import { seedCourses } from "./seed/courses";

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

/** Real courses from courses.json when present and valid; otherwise the demo seed. */
export function loadCourseFiles(): { courses: CourseRecord[]; fromCatalog: boolean } {
  const file = path.join(CATALOG_DIR, "courses.json");
  if (existsSync(file)) {
    const parsed = z.array(CourseRecordSchema).safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) return { courses: parsed.data, fromCatalog: true };
    console.warn("[catalog] data/catalog/courses.json is invalid; falling back to demo courses");
  }
  return { courses: seedCourses, fromCatalog: false };
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
