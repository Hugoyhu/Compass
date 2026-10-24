/**
 * PeopleSoft scraper output (data/ in this folder) → data/catalog/courses.json,
 * data/catalog/offerings/<term>.json, and import-report.md.
 *
 *   npm run import:courses                 # full import, model parsing within --budget (USD, default 3)
 *   npm run import:courses -- --no-model   # rules and cached model results only, no API calls
 *
 * Other flags: --input (scraper output folder here, default data), --model, --effort, --concurrency (default 4).
 * Model results are cached in prereq-cache.json, so reruns are free.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CourseCodeSchema, type CourseCode, type Season } from "@/lib/domain/catalog/common";
import { CourseRecordSchema, type CourseRecord, type Prereq } from "@/lib/domain/catalog/course";
import { OfferingTermSchema, type OfferingTerm, type Section } from "@/lib/domain/catalog/offering";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import { referencedCourses } from "@/lib/domain/catalog/validate";
import { loadEnv } from "../major-minor/config";
import {
  equivalents,
  isNonTechnical,
  sbcMinGrade,
  sbcTags,
  splitPageText,
  type RequirementSegment,
} from "./enrollment";
import { CACHE_FILE, parseWithModel, type ModelRunResult } from "./prereq-llm";
import { allowConcurrent, hasUnparsed, parseSimplePrereq } from "./prereq-rules";

const HERE = path.resolve("utilities/scrapers/course-offering-scraper");
// Scraper output folder; --input=data-fresh reads another run.
const RAW = path.join(HERE, process.argv.find((a) => a.startsWith("--input="))?.split("=")[1] ?? "data");
const CATALOG_DIR = path.resolve("data/catalog");
const OFFERINGS_DIR = path.join(CATALOG_DIR, "offerings");
const REPORT_FILE = path.join(HERE, "import-report.md");

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

interface RawMeeting {
  days: string | null;
  start: string | null;
  end: string | null;
  room: string | null;
  instructor: string | null;
  dates: string | null;
}

interface RawSection {
  course_code: string;
  section: string;
  class_number: string | null;
  session: string | null;
  meetings: RawMeeting[];
}

interface RawDetail {
  course_code: string | null;
  catalog_course_code: string | null;
  title: string;
  career: string;
  credits_range: string;
  course_component: string | null;
  description: string | null;
  prerequisite_related_text: string[];
  /** Whole page text; newer scrapes only. Older ones kept just the lines mentioning prerequisites. */
  page_text?: string;
}

const SEASON_CODE: Record<Season, string> = { Spring: "SP", Summer: "SU", Fall: "FA", Winter: "WI" };

/** "07/06/2026" → "2026-07-06". */
function isoDate(us: string): string {
  const [m, d, y] = us.split("/");
  return `${y}-${m}-${d}`;
}

/**
 * Term ids the scrape collected sections for ("Spring 2027" → "2027-SP"), or
 * null when it asked for every term. Only these term files are replaced.
 */
function scrapedTerms(sectionsTerm: string | undefined): Set<string> | null {
  if (!sectionsTerm || /^all$/i.test(sectionsTerm.trim())) return null;
  const ids = sectionsTerm.split(",").flatMap((t) => {
    const m = t.trim().match(/^(Spring|Summer|Fall|Winter) (\d{4})$/);
    return m ? [`${m[2]}-${SEASON_CODE[m[1] as Season]}`] : [];
  });
  return ids.length > 0 ? new Set(ids) : null;
}

/** Existing term files the scrape didn't cover; they are kept as they are. */
function keptOfferings(scraped: Set<string> | null): OfferingTerm[] {
  if (!scraped || !existsSync(OFFERINGS_DIR)) return [];
  return readdirSync(OFFERINGS_DIR)
    .filter((f) => f.endsWith(".json") && !scraped.has(f.replace(/\.json$/, "")))
    .map((f) => OfferingTermSchema.parse(JSON.parse(readFileSync(path.join(OFFERINGS_DIR, f), "utf8"))));
}

/** Section course codes sometimes use the index format, "CSE (330)". */
function normalizeCode(code: string): string {
  return code.replace(/^([A-Z]{3,4}) \((\d{3})\)$/, "$1 $2");
}

/** Real term from the first meeting's start date; the scraper's term label is wrong. */
function termOf(section: RawSection): { season: Season; year: string } | undefined {
  const match = section.meetings.find((m) => m.dates)?.dates?.match(/^(\d{2})\/\d{2}\/(\d{4})/);
  if (!match) return undefined;
  const month = Number(match[1]);
  return { season: month <= 4 ? "Spring" : month <= 7 ? "Summer" : "Fall", year: match[2] };
}

function toSection(raw: RawSection): Section {
  const dash = raw.section.lastIndexOf("-");
  const korea = raw.session === "SGB" || raw.meetings.some((m) => /korea/i.test(m.room ?? ""));
  return {
    code: raw.course_code,
    section: dash >= 0 ? raw.section.slice(0, dash) : raw.section,
    component: dash >= 0 ? raw.section.slice(dash + 1) : "",
    classNumber: raw.class_number ?? "",
    session: raw.session ?? "",
    campus: korea ? "korea" : "main",
    meetings: raw.meetings.map((m) => {
      const [from = "", to = ""] = (m.dates ?? "").split(" - ");
      return {
        days: m.days ?? "TBA",
        start: m.start ?? "",
        end: m.end ?? "",
        room: m.room ?? "",
        instructor: m.instructor ?? "",
        startDate: from ? isoDate(from) : "",
        endDate: to ? isoDate(to) : "",
      };
    }),
  };
}

function credits(range: string): { min: number; max: number } {
  const [min, max = min] = range.split("-").map((s) => Number(s.trim()));
  return { min, max };
}

/** Seeded PRNG so the review sample is the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const useModel = !process.argv.includes("--no-model");
  const summary = JSON.parse(readFileSync(path.join(RAW, "export-summary.json"), "utf8"));
  const details: RawDetail[] = JSON.parse(readFileSync(path.join(RAW, "course-details.json"), "utf8"));
  const rawSections: RawSection[] = JSON.parse(readFileSync(path.join(RAW, "course-sections.json"), "utf8"));
  const index: { course_code: string; subject: string; course_number: string; title: string }[] = JSON.parse(
    readFileSync(path.join(RAW, "course-index.json"), "utf8"),
  );
  const fetchedAt = String(summary.exported_at_utc).slice(0, 10);
  const courseSource = { catalog: "Stony Brook PeopleSoft course catalog", url: summary.catalog_url, fetchedAt };
  const sectionSource = { catalog: "Stony Brook PeopleSoft class search", url: summary.catalog_url, fetchedAt };

  // --- Undergraduate details: valid codes, duplicates merged (first wins) -------------
  const invalidCodes: string[] = [];
  const duplicates: { code: string; kept: string; dropped: string }[] = [];
  const byCode = new Map<CourseCode, RawDetail>();
  for (const d of details.filter((d) => d.career === "Undergraduate")) {
    const code = d.course_code ?? d.catalog_course_code ?? "";
    if (!CourseCodeSchema.safeParse(code).success) {
      invalidCodes.push(code || "(none)");
      continue;
    }
    const first = byCode.get(code);
    if (first) duplicates.push({ code, kept: first.title, dropped: d.title });
    else byCode.set(code, d);
  }

  // --- Sections by real term ----------------------------------------------------------
  const terms = new Map<string, Section[]>();
  const mainSeasons = new Map<CourseCode, Set<Season>>();
  let nonUndergradSections = 0;
  let undated = 0;
  let outsideScrapedTerms = 0;
  const scraped = scrapedTerms(summary.sections_term);
  const kept = keptOfferings(scraped);
  const SEASON_OF: Record<string, Season> = { SP: "Spring", SU: "Summer", FA: "Fall", WI: "Winter" };
  for (const o of kept) {
    for (const s of o.sections) {
      if (s.campus === "main") mainSeasons.set(s.code, (mainSeasons.get(s.code) ?? new Set()).add(SEASON_OF[o.term.slice(5)]));
    }
  }
  // A rescraped course leaves its older rows behind under a different term label; keep the newest row per section.
  const latest = new Map<string, RawSection>();
  for (const r of rawSections) {
    const row = { ...r, course_code: normalizeCode(r.course_code) };
    latest.set(`${row.course_code}|${row.class_number}|${row.section}`, row);
  }
  for (const raw of latest.values()) {
    const term = termOf(raw);
    if (!term) {
      undated++;
      continue;
    }
    if (!byCode.has(raw.course_code)) {
      nonUndergradSections++;
      continue;
    }
    const section = toSection(raw);
    const id = `${term.year}-${SEASON_CODE[term.season]}`;
    // Stray rows dated in another term would replace that term's full file with a handful of sections.
    if (scraped && !scraped.has(id)) {
      outsideScrapedTerms++;
      continue;
    }
    terms.set(id, [...(terms.get(id) ?? []), section]);
    if (section.campus === "main") {
      mainSeasons.set(section.code, (mainSeasons.get(section.code) ?? new Set()).add(term.season));
    }
  }

  // --- Courses -------------------------------------------------------------------------
  interface Draft {
    record: CourseRecord;
    prereqSegments: RequirementSegment[];
    emptyPage: boolean;
  }
  const drafts: Draft[] = [];
  for (const [code, d] of byCode) {
    const pageText = d.page_text ?? d.prerequisite_related_text.join(" ");
    const description = d.description ?? "";
    const parts = splitPageText(pageText, description);
    const segs = (...kinds: RequirementSegment["kind"][]) => parts.segments.filter((s) => kinds.includes(s.kind));
    // Unlabeled requirement text is a misspelled label ("Prereq:", "Pre-requisite:"); treat it as a prerequisite.
    const prereqSegments = [
      ...(parts.unlabeled ? [{ kind: "prereq" as const, label: "", text: parts.unlabeled }] : []),
      ...segs("prereq", "preco"),
    ];
    const joined = (list: RequirementSegment[], keepLabel: (s: RequirementSegment) => boolean) =>
      list.map((s) => (keepLabel(s) ? `${s.label.trim()} ${s.text}` : s.text)).join(" ") || undefined;
    const hasPreco = prereqSegments.some((s) => s.kind === "preco");

    const seasons = mainSeasons.get(code);
    const attributes = [
      ...(/\bhonors\b/i.test(d.title) ? ["honors"] : []),
      ...(isNonTechnical(description) ? ["non-technical"] : []),
      ...(d.course_component === "Laboratory" && !/Lecture Required/.test(pageText) ? ["lab"] : []),
    ];
    const record: CourseRecord = {
      code,
      title: d.title,
      credits: credits(d.credits_range),
      description,
      sbc: sbcTags(parts.attributes),
      // Keep "Pre- or Corequisite:" in the text so readers can tell it apart from a plain prerequisite.
      prerequisiteText: joined(prereqSegments, (s) => hasPreco && s.label !== ""),
      corequisiteText: joined(segs("coreq"), () => false),
      advisoryText: joined(segs("advisory"), (s) => segs("advisory").length > 1 && Boolean(s.label)),
      sbcMinGrade: sbcMinGrade(parts.designation),
      equivalents: equivalents(code, description, segs("anti").map((s) => s.text)),
      attributes,
      typicallyOffered: seasons ? (["Spring", "Summer", "Fall"] as Season[]).filter((s) => seasons.has(s)) : undefined,
      source: courseSource,
    };
    for (const key of Object.keys(record) as (keyof CourseRecord)[]) if (record[key] === undefined) delete record[key];
    drafts.push({ record, prereqSegments, emptyPage: pageText.trim() === "" });
  }

  // --- Prerequisite trees: rules first, then the model -----------------------------------
  const ruleTrees = new Map<string, Prereq>();
  const forModel: string[] = [];
  for (const { prereqSegments } of drafts) {
    for (const s of prereqSegments) {
      const tree = parseSimplePrereq(s.text);
      if (tree) ruleTrees.set(s.text, tree);
      else forModel.push(s.text);
    }
  }
  let model: ModelRunResult = { trees: new Map(), failures: new Map(), costUsd: 0, fromCache: 0, skipped: 0 };
  const modelName = arg("model") ?? "claude-haiku-5-5";
  if (forModel.length > 0) {
    // Without the model, cached trees from earlier runs still apply.
    if (useModel) loadEnv();
    model = await parseWithModel(forModel, {
      cacheOnly: !useModel,
      model: modelName,
      effort: (arg("effort") as "low" | "medium" | "high") ?? "medium",
      budgetUsd: Number(arg("budget") ?? 3),
      concurrency: Number(arg("concurrency") ?? 4),
    });
  }

  let fromRules = 0;
  let fromModel = 0;
  for (const draft of drafts) {
    const trees: Prereq[] = [];
    for (const s of draft.prereqSegments) {
      const tree = ruleTrees.get(s.text) ?? model.trees.get(s.text);
      if (!tree) {
        trees.length = 0;
        break;
      }
      trees.push(s.kind === "preco" ? allowConcurrent(tree) : tree);
    }
    if (draft.prereqSegments.length > 0 && trees.length === draft.prereqSegments.length) {
      draft.record.prerequisites = trees.length === 1 ? trees[0] : { type: "and", of: trees };
      if (draft.prereqSegments.every((s) => ruleTrees.has(s.text))) fromRules++;
      else fromModel++;
    }
  }

  // --- Validate and write ------------------------------------------------------------
  const records = drafts.map((d) => d.record).sort((a, b) => a.code.localeCompare(b.code));
  for (const r of records) {
    const parsed = CourseRecordSchema.safeParse(r);
    if (!parsed.success) throw new Error(`${r.code} failed CourseRecordSchema: ${parsed.error.issues[0]?.message}`);
  }
  writeFileSync(path.join(CATALOG_DIR, "courses.json"), JSON.stringify(records, null, 1) + "\n");
  // A full scrape (every term) regenerates the folder so a term that disappears doesn't linger;
  // a scrape of some terms replaces only those files.
  if (!scraped) rmSync(OFFERINGS_DIR, { recursive: true, force: true });
  mkdirSync(OFFERINGS_DIR, { recursive: true });
  const offerings: OfferingTerm[] = [...terms]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([term, sections]) => ({
      term: term as OfferingTerm["term"],
      source: sectionSource,
      sections: sections.sort((a, b) => a.code.localeCompare(b.code) || a.section.localeCompare(b.section)),
    }));
  for (const o of offerings) {
    OfferingTermSchema.parse(o);
    writeFileSync(path.join(OFFERINGS_DIR, `${o.term}.json`), JSON.stringify(o, null, 1) + "\n");
  }

  // --- Report --------------------------------------------------------------------------
  const validation = spawnSync("npm", ["run", "--silent", "validate:catalog"], { encoding: "utf8" });
  const validationLines = (validation.stdout ?? "").split("\n");
  const missingCourseWarnings = validationLines.filter((l) => l.includes("referenced courses not in the course catalog"));
  const otherProblems = validationLines.filter(
    (l) => (l.startsWith("✗") || l.startsWith("!")) && !missingCourseWarnings.includes(l),
  );

  const withText = records.filter((r) => r.prerequisiteText);
  const withTree = records.filter((r) => r.prerequisites);
  const partial = withTree.filter((r) => hasUnparsed(r.prerequisites!));
  const sbcCounts = new Map<string, number>();
  records.forEach((r) => r.sbc.forEach((s) => sbcCounts.set(s.category, (sbcCounts.get(s.category) ?? 0) + 1)));
  const detailCodes = new Set(details.map((d) => d.course_code ?? d.catalog_course_code));
  const missingDetails = [...new Set(index.map((i) => normalizeCode(i.course_code)))]
    .filter((code) => CourseCodeSchema.safeParse(code).success && Number(code.split(" ")[1]) < 500 && !detailCodes.has(code))
    .sort();
  // Subjects that programs use but the export has no undergraduate course for, e.g. a subject the index scrape skipped.
  const catalogSubjects = new Set(records.map((r) => r.code.split(" ")[0]));
  const indexSubjects = new Set(index.map((i) => i.subject));
  const programSubjects = new Map<string, Set<string>>();
  for (const file of readdirSync(path.join(CATALOG_DIR, "programs")).filter((f) => f.endsWith(".json"))) {
    const program: ProgramDefinition = JSON.parse(readFileSync(path.join(CATALOG_DIR, "programs", file), "utf8"));
    for (const code of referencedCourses(program)) {
      const subject = code.split(" ")[0];
      if (!catalogSubjects.has(subject)) programSubjects.set(subject, (programSubjects.get(subject) ?? new Set()).add(program.id));
    }
  }
  const byCodeRecord = new Map(records.map((r) => [r.code, r]));

  const spot: [string, boolean][] = [
    ["CSE 114 → TECH", byCodeRecord.get("CSE 114")?.sbc.some((s) => s.category === "TECH") ?? false],
    ["PHY 131 → SNW", byCodeRecord.get("PHY 131")?.sbc.some((s) => s.category === "SNW") ?? false],
    ["AMS 151 → QPS", byCodeRecord.get("AMS 151")?.sbc.some((s) => s.category === "QPS") ?? false],
    ["WRT 102 → WRT", byCodeRecord.get("WRT 102")?.sbc.some((s) => s.category === "WRT") ?? false],
    ["CSE 312 → CER, ESI, STAS", ["CER", "ESI", "STAS"].every((c) => byCodeRecord.get("CSE 312")?.sbc.some((s) => s.category === c))],
    ["CSE 300 → SPK, WRTD", ["SPK", "WRTD"].every((c) => byCodeRecord.get("CSE 300")?.sbc.some((s) => s.category === c))],
    [
      "CSE 214 requires CSE 114 with C or higher",
      JSON.stringify(byCodeRecord.get("CSE 214")?.prerequisites) === JSON.stringify({ type: "course", code: "CSE 114", minGrade: "C" }),
    ],
    ["CSE 214 typically offered in Spring", byCodeRecord.get("CSE 214")?.typicallyOffered?.includes("Spring") ?? false],
    ["CSE 301 is non-technical", byCodeRecord.get("CSE 301")?.attributes.includes("non-technical") ?? false],
  ];

  const random = mulberry32(2026);
  const sample = [...withTree]
    .map((r) => ({ r, k: random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 20)
    .map(({ r }) => r)
    .sort((a, b) => a.code.localeCompare(b.code));

  const pct = (n: number, of: number) => `${of ? Math.round((100 * n) / of) : 0}%`;
  const lines = [
    "# Course import report",
    "",
    `Source: PeopleSoft export from ${fetchedAt}. Generated by \`npm run import:courses\`.`,
    "",
    "## Acceptance checks",
    "",
    ...spot.map(([label, ok]) => `- ${ok ? "✓" : "✗"} ${label}`),
    `- ${validation.status === 0 ? "✓" : "✗"} \`validate:catalog\` ${validation.status === 0 ? "passes" : "FAILS"}`,
    "",
    "## Courses",
    "",
    `- Undergraduate courses: **${records.length}**`,
    `- With prerequisite text: ${withText.length}`,
    `- With a prerequisite tree: ${withTree.length} (${pct(withTree.length, withText.length)}): ${fromRules} by rules, ${fromModel} with the model`,
    `- Parsed fully (no \`unparsed\` nodes): ${withTree.length - partial.length}`,
    `- Containing \`unparsed\` nodes: ${partial.length}`,
    `- Prerequisite text but no tree: ${withText.length - withTree.length}`,
    `- With corequisite text: ${records.filter((r) => r.corequisiteText).length}; advisory text: ${records.filter((r) => r.advisoryText).length}; SBC minimum grade: ${records.filter((r) => r.sbcMinGrade).length}`,
    `- With equivalents: ${records.filter((r) => r.equivalents.length).length}; typically offered known: ${records.filter((r) => r.typicallyOffered).length}`,
    `- Attributes: ${["honors", "non-technical", "lab"].map((a) => `${a} ${records.filter((r) => r.attributes.includes(a)).length}`).join(", ")}`,
    `- **No page text at all** (the scraper captured an empty page, so no prerequisites or SBC tags): ${drafts.filter((d) => d.emptyPage).length}`,
    `- Undergraduate records skipped for invalid codes: ${invalidCodes.length}${invalidCodes.length ? ` (${invalidCodes.join(", ")})` : ""}`,
    "",
    "## Cost",
    "",
    useModel
      ? `$${model.costUsd.toFixed(2)} with ${modelName} for ${new Set(forModel).size} distinct texts (${model.fromCache} from cache, ${model.failures.size} failed, ${model.skipped} skipped by budget). Cached in \`${path.relative(process.cwd(), CACHE_FILE)}\`.`
      : "Model parsing was off (`--no-model`).",
    "",
    "## SBC tags",
    "",
    "| Tag | Courses |",
    "|---|---|",
    ...[...sbcCounts].sort((a, b) => b[1] - a[1]).map(([tag, n]) => `| ${tag} | ${n} |`),
    "",
    "## Offerings",
    "",
    ...offerings.map(
      (o) =>
        `- ${o.term}: ${o.sections.length} sections (${o.sections.filter((s) => s.campus === "korea").length} at SUNY Korea)`,
    ),
    `- Sections skipped: ${nonUndergradSections} for graduate or unknown courses, ${undated} with no meeting dates${scraped ? `, ${outsideScrapedTerms} dated outside the scraped term (${[...scraped].join(", ")})` : ""}`,
    ...(kept.length > 0 ? [`- Kept from earlier imports: ${kept.map((o) => `${o.term} (${o.sections.length} sections)`).join(", ")}`] : []),
    "",
    "## Duplicates merged",
    "",
    ...(duplicates.length ? duplicates.map((d) => `- ${d.code}: kept "${d.kept}", dropped "${d.dropped}"`) : ["None."]),
    "",
    "## Prerequisite failures",
    "",
    ...(model.failures.size
      ? [...model.failures].map(([text, error]) => `- "${text}": ${error}`)
      : ["None."]),
    "",
    "## Review sample: 20 random prerequisite trees",
    "",
    ...sample.flatMap((r) => [`**${r.code}**: ${r.prerequisiteText}`, "", "```json", JSON.stringify(r.prerequisites), "```", ""]),
    "## Subjects programs use that have no courses in the export",
    "",
    "A subject missing from the course index needs the index scrape rerun; one in the index but without details needs the detail scrape rerun.",
    "",
    ...(programSubjects.size
      ? [...programSubjects]
          .sort((a, b) => b[1].size - a[1].size)
          .map(
            ([subject, ids]) =>
              `- ${subject}: used by ${ids.size} program${ids.size === 1 ? "" : "s"}; ${indexSubjects.has(subject) ? "in the index, details missing" : "not in the index"}`,
          )
      : ["None."]),
    "",
    "## Program requirements naming courses not in courses.json",
    "",
    "From `validate:catalog`. Some are graduate courses, retired courses, or missing details below; others are extraction mistakes in the program files.",
    "",
    ...(missingCourseWarnings.length ? missingCourseWarnings.map((l) => `- ${l.replace(/^! /, "")}`) : ["None."]),
    "",
    ...(otherProblems.length ? ["## Other validation output", "", ...otherProblems.map((l) => `- ${l}`), ""] : []),
    `## Index entries with no detail record (${missingDetails.length}, numbered below 500)`,
    "",
    "Rerun the scraper (it resumes) to fill these in.",
    "",
    missingDetails.join(", "),
    "",
  ];
  writeFileSync(REPORT_FILE, lines.join("\n"));

  console.log(lines.slice(0, lines.indexOf("## SBC tags")).join("\n"));
  console.log(`Report: ${path.relative(process.cwd(), REPORT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
