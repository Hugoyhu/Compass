# Handoff: import PeopleSoft course data into the catalog

You own this. The app session has profiled the data (findings below) and will wire the results into the app once they exist. Ownership rules from `utilities/scrapers/major-minor/HANDOFF.md` still apply: you own `utilities/` and `data/catalog/`; don't edit `app/`, `components/`, or `lib/` outside `lib/domain/catalog/`. Don't commit or push.

## Goal

Turn the scraper output in `data/` (this folder) into:

1. **`data/catalog/courses.json`**: every **undergraduate** course as `CourseRecord[]` (`lib/domain/catalog/course.ts`). Skip graduate and non-credit courses.
2. **`data/catalog/offerings/<term>.json`**: one file per real term (`2026-SU`, `2026-FA`, `2027-SP`) with that term's sections. The schema is new (see below).
3. **A report** (`import-report.md` in this folder) for the user.

**Important:** the app loads `data/catalog/courses.json` automatically as soon as it exists and validates. It falls back to demo courses if the file is invalid. So run `npm run validate:catalog` before calling it done.

Write the import in **TypeScript** (run with `tsx`, add npm scripts) so it reuses the Zod schemas.

## What's in the data (profiled by the app session)

`course-details.json`: 5,680 records (2,887 Undergraduate, 2,789 Graduate, 4 SB Non Credit).

- **Code:** `course_code`. It's null on 5 records; fall back to `catalog_course_code`. Drop the 7 codes that don't match `^[A-Z]{3,4} \d{3}$`.
- **Duplicates:** 3 duplicate undergraduate codes (`ADV 488` has two different topic titles; `EST 221`, `EST 371`). Merge them and keep the first title, noting it in the report.
- **Credits:** `credits_range` is `"4.00"` or `"3.00 - 4.00"`; map it to `{min, max}`.
- **Enrollment text:** there's no structured prerequisite field. Everything is inside `prerequisite_related_text`, a blob of the whole page text. Take the text between `Enrollment Requirement` and `Description`, then split it on these labels (counts are across undergraduate courses):
  - `Prerequisite(s):` (≈2,330) → `prerequisiteText`
  - `Pre- or Corequisite:` → `prerequisiteText`; mark those courses `concurrentAllowed: true` in the tree
  - `Corequisite(s):` / `Co-requisite:` (≈240) → `corequisiteText`
  - `Advisory Prerequisite(s):` / `Advisory Corequisite:` (≈240) → **new optional field `advisoryText`** (recommended, not enforced)
  - `Anti-requisite` (8) → codes into `equivalents`
  - `Program Corequisite` (2) → `corequisiteText`
  - `Requirement Designation …` → ignore the old DEC code, but `Required grade: A through C` → **new optional field `sbcMinGrade`** (`"C"`; `"A through D"` → `"D"`)
  - `Course Attribute …` → SBC tags (next item)
- **SBC tags:** codes at the start of each attribute, such as `Course Attribute Controlled Access TECH Understand Technology` → `TECH`. Recognize `ARTS GLO HUM LANG QPS SBS SNW TECH USA WRT STAS EXP+ HFA+ SBS+ STEM+ CER DIV ESI SPK WRTD`. Match `WRTD` before `WRT` and `SBS+` before `SBS`. Drop non-SBC attributes like "Controlled Access". Spot checks that must come out right: CSE 114 → TECH; PHY 131 → SNW; AMS 151 → QPS; WRT 102 → WRT; CSE 312 → CER, ESI, STAS; CSE 300 → SPK, WRTD.
- **Equivalents:** about 200 descriptions say "Not for credit in addition to X". Extract those codes into `equivalents`.
- **Attributes:** `honors` when the title says Honors. `non-technical` when the description designates the course as non-technical; the CS BS electives rule depends on it (CSE 301 is the catalog's example), so check how the descriptions word it. `lab` when the only component is a laboratory.
- **Missing details:** `course-index.json` has 5,889 entries, about 290 without a detail record, including `ARH 101` and `ARH 240`. Index codes are formatted like `"AAS (301)"`. List the missing undergraduate ones in the report; the user may rerun the scraper (it resumes) to fill them.

`course-sections.json`: 9,305 sections.

- **The `term` field is wrong:** every section says "Spring 2027". Derive the real term from the meeting `dates` start: Jan–Apr → Spring, May–Jul → Summer, Aug–Dec → Fall, same year. Real counts: 4,362 Spring 2027 (dates `01/25/2027 - 05/19/2027`), 1,970 Fall 2026, 2,973 Summer 2026. Please also fix `scrape_catalog.py` to label terms from the dates.
- **Korea campus:** about 204 sections are SUNY Korea (`session` `SGB`, rooms mentioning Korea). Mark them `campus: "korea"`. They must not count toward main-campus offerings.
- `section` is like `"30-LEC"`; split it into section `"30"` and component `"LEC"`. `status` is always null; drop it.

## Output details

### `courses.json`

Map into the existing `CourseRecord` fields:

- `source`: `{ catalog: "Stony Brook PeopleSoft course catalog", url: <catalog_url from export-summary.json>, fetchedAt: <export date> }`
- `typicallyOffered`: the seasons in which the course has at least one **main-campus** section in the 2026–27 data. Leave it empty or omit it when there are none; the app treats a missing value as "unknown".

**Prerequisite trees** (`prerequisites`, using the existing `Prereq` type):

- **Parse simple patterns in code first:** a single code, "X and Y", "X or Y", "C or higher in X" (→ `minGrade`), "U3 or U4 standing" (→ `standing` U3), "CSE major" (→ `program`).
- **Send the rest to Claude Haiku 5.5** (`claude-haiku-5-5`), ideally through the Message Batches API. Load the `claude-api` skill before writing API code.
- **Expand codes with the subject left out:** "PHI 300, 304, 306" → PHI 300, PHI 304, PHI 306.
- **Unverifiable conditions:** placement exam scores, auditions and test scores → `unparsed` nodes with the verbatim text; instructor or department permission → `permission`.
- **Never guess.** An `unparsed` node is better than a wrong tree, and `prerequisiteText` always stays verbatim.
- Corequisites get text only for now; no tree.

### Schema changes (you may make these in `lib/domain/catalog/`)

- **`course.ts`:** add optional `advisoryText: string` and optional `sbcMinGrade: LetterGrade` to the course schema.
- **New `offering.ts`**, exported from `index.ts`:

  ```ts
  OfferingTerm = {
    term: TermId;              // "2027-SP"
    source: Source;
    sections: {
      code: CourseCode;
      section: string;         // "30"
      component: string;       // "LEC" | "REC" | "LAB" | ...
      classNumber: string;
      session: string;
      campus: "main" | "korea";
      meetings: { days: string; start: string; end: string; room: string; instructor: string; startDate: string; endDate: string }[];
    }[];
  }
  ```

  Add `offerings/*.json` checks to `scripts/validate-catalog.ts`: schema validity, and every section code exists in `courses.json`, as a warning.

## Budget and checks

- **Prerequisite parsing should cost under $3.** Report the actual cost, and ask the user before spending more.
- **Acceptance:**
  - `npm run validate:catalog` passes.
  - `npx tsc --noEmit` and `npm run lint` are clean.
  - The SBC spot checks above are right.
  - `CSE 214` has prerequisite `CSE 114` with minimum grade C, and `typicallyOffered` includes Spring.
- **Report** (`import-report.md`):
  - counts: undergraduate courses, with prerequisite text, parsed fully, containing `unparsed` nodes
  - SBC tag counts
  - cost
  - the missing-detail list
  - duplicates merged
  - 20 random parsed prerequisites, next to their text, for a person to review
  - the `validate:catalog` warnings about program requirements that reference courses not found in `courses.json`. This is a useful cross-check on the extracted programs.
- **Gitignore this folder's raw output** (`data/`: ~60 MB of JSON, CSV and HTML). Commit only the normalized files in `data/catalog/`.

## Afterwards

Tell the user when it's done. The app session will then make the planner use `offerings/2027-SP.json` for "offered next term", show sections in the Course Explorer, and use `advisoryText` and `sbcMinGrade`.
