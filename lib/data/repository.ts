/**
 * Data access boundary. Pages and services depend on this interface, never on
 * seed files or data/catalog directly, so sources can be swapped without
 * touching the UI.
 *
 * Current sources:
 * - Programs: data/catalog/programs/*.json (real catalog data, validated on load)
 * - Courses: demo seed until data/catalog/courses.json exists
 * - Student: not here. Each visitor's record lives in their browser cookies
 *   (lib/student/store.ts); the fictional sample student is offered as a preset.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CourseRecordSchema, type CourseRecord } from "@/lib/domain/catalog/course";
import { ProgramDefinitionSchema, type ProgramDefinition } from "@/lib/domain/catalog/program";
import type { SbcCategory, StudentRecord } from "@/lib/domain/types";
import { seedCourses } from "./seed/courses";
import { seedSbcCategories, universityCreditRules } from "./seed/sbc";
import { seedStudent } from "./seed/student";

export interface DataSourceInfo {
  label: string;
  /** True while any part of what the app shows is demo data. */
  includesDemoData: boolean;
  disclaimer: string;
}

export interface CompassRepository {
  source(): Promise<DataSourceInfo>;
  listCourses(): Promise<CourseRecord[]>;
  listPrograms(): Promise<ProgramDefinition[]>;
  listSbcCategories(): Promise<SbcCategory[]>;
  getUniversityCreditRules(): Promise<typeof universityCreditRules>;
  /** The fictional sample student, for demos. */
  getSampleStudent(): Promise<StudentRecord>;
}

const CATALOG_DIR = path.join(process.cwd(), "data/catalog");

function loadPrograms(): ProgramDefinition[] {
  const dir = path.join(CATALOG_DIR, "programs");
  if (!existsSync(dir)) return [];
  const programs: ProgramDefinition[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = ProgramDefinitionSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    // An invalid draft must not take the app down; validate:catalog reports details.
    if (parsed.success) programs.push(parsed.data);
    else console.warn(`[catalog] Skipping invalid program file ${file}`);
  }
  return programs;
}

function loadCourses(): { courses: CourseRecord[]; fromCatalog: boolean } {
  const file = path.join(CATALOG_DIR, "courses.json");
  if (existsSync(file)) {
    const parsed = z.array(CourseRecordSchema).safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) return { courses: parsed.data, fromCatalog: true };
    console.warn("[catalog] data/catalog/courses.json is invalid; falling back to demo courses");
  }
  return { courses: seedCourses, fromCatalog: false };
}

function createRepository(): CompassRepository {
  let programs: ProgramDefinition[] | undefined;
  let courses: ReturnType<typeof loadCourses> | undefined;
  const getPrograms = () => (programs ??= loadPrograms());
  const getCourses = () => (courses ??= loadCourses());

  return {
    async source() {
      const fromCatalog = getCourses().fromCatalog;
      return {
        label: "Demo data",
        includesDemoData: true,
        disclaimer: [
          "Degree requirements are transcribed from the Stony Brook Fall 2026 Undergraduate Catalog and have not been officially verified.",
          fromCatalog
            ? "Course details come from the catalog."
            : "Course details (prerequisites, offerings) are an approximate demo sample.",
        ].join(" "),
      };
    },
    async listCourses() {
      return getCourses().courses;
    },
    async listPrograms() {
      return getPrograms();
    },
    async listSbcCategories() {
      return seedSbcCategories;
    },
    async getUniversityCreditRules() {
      return universityCreditRules;
    },
    async getSampleStudent() {
      return seedStudent;
    },
  };
}

const repository = createRepository();

export function getRepository(): CompassRepository {
  return repository;
}
