/**
 * Data access boundary. Pages and services depend on this interface, never on
 * seed files, data/catalog, or the database directly, so sources can be
 * swapped without touching the UI.
 *
 * Catalog source, chosen by DATA_SOURCE:
 * - "files" (default): data/catalog/*.json, validated on load
 * - "postgres": the database loaded by scripts/db-load.ts (DATABASE_URL)
 *
 * Student records are not here: see lib/student/store.ts.
 */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { Section } from "@/lib/domain/catalog/offering";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import type { SbcCategory, StudentRecord, TermId } from "@/lib/domain/types";
import { loadCourseFiles, loadOfferingFiles, loadProgramFiles } from "./catalog-files";
import { fetchCourses, fetchOfferingSections, fetchPrograms } from "./postgres-catalog";
import { seedSbcCategories, universityCreditRules } from "./seed/sbc";
import { seedStudent } from "./seed/student";

export interface CompassRepository {
  listCourses(): Promise<CourseRecord[]>;
  listPrograms(): Promise<ProgramDefinition[]>;
  /**
   * Class sections scheduled in a term, or null when there's no data for that
   * term. Coverage is incomplete: a course without sections is "unknown", not
   * "not offered".
   */
  listSections(term: TermId): Promise<Section[] | null>;
  listSbcCategories(): Promise<SbcCategory[]>;
  getUniversityCreditRules(): Promise<typeof universityCreditRules>;
  /** The fictional sample student, for demos. */
  getSampleStudent(): Promise<StudentRecord>;
}

const shared = {
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

function fileRepository(): CompassRepository {
  let programs: ProgramDefinition[] | undefined;
  let courses: ReturnType<typeof loadCourseFiles> | undefined;
  let offerings: ReturnType<typeof loadOfferingFiles> | undefined;
  const getCourses = () => (courses ??= loadCourseFiles());
  return {
    ...shared,
    async listCourses() {
      return getCourses().courses;
    },
    async listPrograms() {
      return (programs ??= loadProgramFiles());
    },
    async listSections(term) {
      return (offerings ??= loadOfferingFiles()).find((o) => o.term === term)?.sections ?? null;
    },
  };
}

function postgresRepository(): CompassRepository {
  return {
    ...shared,
    listCourses: fetchCourses,
    listPrograms: fetchPrograms,
    listSections: fetchOfferingSections,
  };
}

const repository: CompassRepository =
  process.env.DATA_SOURCE === "postgres" ? postgresRepository() : fileRepository();

export function getRepository(): CompassRepository {
  return repository;
}
