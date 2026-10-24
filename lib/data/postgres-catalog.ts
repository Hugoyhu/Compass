/**
 * Catalog reads from Postgres, cached with `use cache` so pages don't query
 * the database per request. Rows were validated by scripts/db-load.ts when
 * loaded, so they're returned as-is.
 */
import { cacheLife, cacheTag } from "next/cache";
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { Section } from "@/lib/domain/catalog/offering";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import { requireSql } from "@/lib/db/client";

export async function fetchCourses(): Promise<CourseRecord[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  const rows = await requireSql()`select data from courses order by code`;
  return rows.map((r) => r.data as CourseRecord);
}

export async function fetchPrograms(): Promise<ProgramDefinition[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  const rows = await requireSql()`select data from programs order by id`;
  return rows.map((r) => r.data as ProgramDefinition);
}

export async function fetchCatalogMeta(): Promise<{ coursesSource: "catalog" | "demo"; offeringTerms: string[] } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  const [row] = await requireSql()`select value from catalog_meta where key = 'catalog'`;
  return (row?.value as { coursesSource: "catalog" | "demo"; offeringTerms: string[] }) ?? null;
}

/** Sections for one term, or null when the database has no offering data for it. */
export async function fetchOfferingSections(term: string): Promise<Section[] | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  const meta = await fetchCatalogMeta();
  if (!meta?.offeringTerms.includes(term)) return null;
  const rows = await requireSql()`
    select course_code, section, component, class_number, session, campus, meetings
    from offering_sections where term = ${term} order by course_code, section`;
  return rows.map((r) => ({
    code: r.course_code,
    section: r.section,
    component: r.component,
    classNumber: r.class_number,
    session: r.session,
    campus: r.campus,
    meetings: r.meetings,
  }));
}
