/**
 * Validates catalog data under data/catalog.
 *
 *   npm run validate:catalog
 *
 * For each program: schema check, cross-reference check, and (if
 * data/catalog/courses.json exists) a check that referenced courses exist.
 * For each offerings/<term>.json: schema check, and a warning for sections
 * whose course isn't in courses.json. Exits non-zero on errors.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CourseRecordSchema } from "@/lib/domain/catalog/course";
import { OfferingTermSchema } from "@/lib/domain/catalog/offering";
import { ProgramDefinitionSchema } from "@/lib/domain/catalog/program";
import { checkProgramReferences } from "@/lib/domain/catalog/validate";

const CATALOG_DIR = path.resolve("data/catalog");
const PROGRAMS_DIR = path.join(CATALOG_DIR, "programs");
const COURSES_FILE = path.join(CATALOG_DIR, "courses.json");
const OFFERINGS_DIR = path.join(CATALOG_DIR, "offerings");

let errors = 0;
const log = (level: "error" | "warning" | "ok", message: string) => {
  if (level === "error") errors++;
  console.log(`${level === "ok" ? "✓" : level === "error" ? "✗" : "!"} ${message}`);
};

let knownCourses: Set<string> | undefined;
if (existsSync(COURSES_FILE)) {
  const parsed = z.array(CourseRecordSchema).safeParse(JSON.parse(readFileSync(COURSES_FILE, "utf8")));
  if (parsed.success) {
    knownCourses = new Set(parsed.data.map((c) => c.code));
    log("ok", `courses.json: ${knownCourses.size} courses`);
  } else {
    log("error", `courses.json failed schema validation:\n${z.prettifyError(parsed.error)}`);
  }
} else {
  log("warning", "No data/catalog/courses.json yet; skipping course existence checks");
}

for (const file of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".json"))) {
  const raw = JSON.parse(readFileSync(path.join(PROGRAMS_DIR, file), "utf8"));
  const parsed = ProgramDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    log("error", `${file}: schema validation failed\n${z.prettifyError(parsed.error)}`);
    continue;
  }
  const program = parsed.data;
  log("ok", `${file}: valid (${program.requirements.length} requirements, ${program.policies.length} policies)`);

  for (const issue of checkProgramReferences(program, knownCourses)) {
    log(issue.level, `${file} ${issue.path}: ${issue.message}`);
  }
}

if (existsSync(OFFERINGS_DIR)) {
  for (const file of readdirSync(OFFERINGS_DIR).filter((f) => f.endsWith(".json"))) {
    const parsed = OfferingTermSchema.safeParse(JSON.parse(readFileSync(path.join(OFFERINGS_DIR, file), "utf8")));
    if (!parsed.success) {
      log("error", `offerings/${file}: schema validation failed\n${z.prettifyError(parsed.error)}`);
      continue;
    }
    const { sections, term } = parsed.data;
    if (`${term}.json` !== file) log("error", `offerings/${file}: term "${term}" doesn't match the file name`);
    log("ok", `offerings/${file}: valid (${sections.length} sections)`);
    if (knownCourses) {
      const unknown = [...new Set(sections.map((s) => s.code).filter((c) => !knownCourses.has(c)))].sort();
      if (unknown.length > 0) log("warning", `offerings/${file}: ${unknown.length} section courses not in courses.json: ${unknown.join(", ")}`);
    }
  }
}

if (errors > 0) {
  console.log(`\n${errors} error(s)`);
  process.exit(1);
}
