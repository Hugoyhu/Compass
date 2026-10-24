/**
 * Loads data/catalog into Postgres. Idempotent: rerun it any time the JSON
 * changes, or against a fresh database (e.g. after moving to Supabase).
 *
 *   npm run db:load
 *
 * Programs, courses (demo seed until courses.json exists), the prerequisite
 * graph, and term offerings are replaced in one transaction. Accounts and
 * student records are never touched.
 */
import { existsSync } from "node:fs";
import postgres from "postgres";
import { loadCourseFiles, loadOfferingFiles, loadProgramFiles } from "@/lib/data/catalog-files";
import { referencedCourses } from "@/lib/engine/prerequisites";

const BATCH = 500;

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const programs = loadProgramFiles();
  const { courses, fromCatalog } = loadCourseFiles();
  const offerings = loadOfferingFiles();
  console.log(
    `Files: ${programs.length} programs, ${courses.length} courses (${fromCatalog ? "catalog" : "demo seed"}), ` +
      `${offerings.length} offering terms`,
  );

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`delete from course_requisites`;
      await tx`delete from offering_sections`;
      await tx`delete from courses`;
      await tx`delete from programs`;

      for (const batch of chunks(courses)) {
        const rows = batch.map((c) => {
          const [subject, number] = c.code.split(" ");
          return { code: c.code, subject, number: Number(number), title: c.title, data: tx.json(c as never) };
        });
        await tx`insert into courses ${tx(rows, "code", "subject", "number", "title", "data")}`;
      }

      const edges = courses.flatMap((c) =>
        [...new Set(referencedCourses(c.prerequisites))]
          .filter((code) => code !== c.code)
          .map((code) => ({ course_code: c.code, requires_code: code, kind: "prerequisite" })),
      );
      for (const batch of chunks(edges)) {
        await tx`insert into course_requisites ${tx(batch, "course_code", "requires_code", "kind")}`;
      }

      for (const batch of chunks(programs, 50)) {
        const rows = batch.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          review_status: p.review.status,
          data: tx.json(p as never),
        }));
        await tx`insert into programs ${tx(rows, "id", "name", "kind", "review_status", "data")}`;
      }

      let sectionCount = 0;
      for (const offering of offerings) {
        const rows = offering.sections.map((s) => ({
          term: offering.term,
          class_number: s.classNumber,
          course_code: s.code,
          section: s.section,
          component: s.component,
          session: s.session,
          campus: s.campus,
          meetings: tx.json(s.meetings as never),
        }));
        for (const batch of chunks(rows)) {
          await tx`insert into offering_sections ${tx(batch, "term", "class_number", "course_code", "section", "component", "session", "campus", "meetings")}
                   on conflict (term, class_number) do nothing`;
        }
        sectionCount += rows.length;
      }

      const meta = {
        coursesSource: fromCatalog ? "catalog" : "demo",
        loadedAt: new Date().toISOString(),
        offeringTerms: offerings.map((o) => o.term),
      };
      await tx`insert into catalog_meta (key, value) values ('catalog', ${tx.json(meta)})
               on conflict (key) do update set value = excluded.value`;

      console.log(`Loaded ${courses.length} courses, ${edges.length} prerequisite edges, ${programs.length} programs, ${sectionCount} sections`);
    });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
