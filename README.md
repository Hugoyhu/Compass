# Compass

A prerequisite-aware degree audit and semester planner for Stony Brook University students. Built as a hackathon MVP.

> **Demo data notice.** The app currently runs on a small, hand-written seed dataset: a subset of courses, a simplified Computer Science B.S., a subset of SBC objectives, and a fictional student. It is **not** the complete or current Stony Brook catalog. Don't rely on it for real advising decisions.

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build (all routes prerender statically)
npm run start      # serve the production build
npm run lint
npx tsc --noEmit   # typecheck
npm run validate:catalog   # check data/catalog against the schemas
npm run test:transcript    # transcript extraction on the fictional fixture (one Claude API call)
npm run test:smoke         # browser smoke test; needs `npm run dev` running and Google Chrome
```

### Environment

Transcript upload calls the Claude API. Put `ANTHROPIC_API_KEY=...` in `.env` at the repo root locally (it's gitignored), and set the same variable in your hosting provider for deployments. Without it the app works, but uploads show a "not configured" message. A public deployment spends real credits on uploads. They're rate-limited per visitor, but also set a spend limit on the key in the Anthropic Console.

## Student records

- **Storage:** each visitor's record (courses, grades, AP/transfer credit, major, current term) is stored only in their browser, as compact cookies split into chunks. There are no accounts and no server database. Cookies are sent with each request, so server components run the audit with the visitor's data.
- **My Courses** (`/record`): add, edit, and remove courses, choose a major, upload a transcript, load the sample student, or clear the record.
- **Transcript upload:** Claude Haiku 5.5 reads the PDF and transcribes course rows into a small flat schema (structured outputs). Plain code then interprets them: AP code suffixes, grades, terms, in-progress detection, printed SBC tags. The student reviews every course before saving. The PDF isn't stored, and ID numbers are never extracted. The fictional fixture in `tests/fixtures/transcript/` mirrors the real layout; never commit real transcripts.

## Catalog data

Real catalog data lives in `data/catalog/` and is validated against the Zod schemas in `lib/domain/catalog/`:

- `programs/*.json`: one `ProgramDefinition` per major. `cse-bs.json` is hand-encoded from the Fall 2026 Undergraduate Catalog and is the reference answer for automated extraction.
- `courses.json` (not yet present): an array of `CourseRecord`.

The app loads every valid file in `programs/` at startup; invalid files are skipped with a warning. Until `courses.json` exists, course details come from the demo seed in `lib/data/seed/courses.ts`, which uses the same `CourseRecord` shape.

Rule trees are recursive, but Claude structured outputs reject recursive JSON Schemas. `programExtractionJsonSchema()` produces an unrolled, depth-limited schema (with shared parts under `$defs`) that accepts the same JSON.

To populate `data/catalog/programs/` from the live catalog, use the scraper in [utilities/scrapers/major-minor/](utilities/scrapers/major-minor/README.md). It uses headless Chrome to fetch pages (the site blocks plain HTTP clients) and Claude Haiku 5.5 to extract them.

## Stack

- Next.js 16 (App Router, Turbopack, Cache Components enabled)
- React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui (`base-nova` style, built on Base UI, so components take `render` props instead of `asChild`)

## Project layout

```text
app/                      Routes (thin; they call services and render components)
  page.tsx                Dashboard
  courses/ progress/ planner/   Placeholders for upcoming milestones
components/
  app-shell/              Sidebar, header, nav config
  dashboard/              Dashboard cards (presentational only)
  audit/                  Shared status badge and progress meter
  ui/                     shadcn/ui components (generated)
lib/
  domain/                 Types (Course, PrereqExpr, Requirement, StudentRecord, SemesterPlan) and term helpers
  data/
    repository.ts         Data access interface plus the seed-backed implementation
    seed/                 Demo courses, SBC categories, and a fictional student (clearly labeled)
  engine/                 Pure planning logic, with no React or I/O
    prerequisites.ts      Evaluate prerequisite expressions and grade floors
    audit.ts              Match coursework to requirements
    planner.ts            Greedy next-semester proposal and graduation estimate
    describe.ts           Plain-language summaries of audit results
  services/               Compose repository and engine into page view models
```

### Design rules

- **Logic stays out of components.** Audit and planning live in `lib/engine` as pure functions. Components only receive results.
- **One data boundary.** Pages reach data only through `getRepository()`. To use real catalog data, write another `CompassRepository` implementation and return it from `getRepository()`. Nothing else needs to change.
- **Data is labeled.** The repository exposes a `source` descriptor, and the UI shows a demo-data badge and notice whenever the source is `demo-seed`.

## How the engine works

- **Prerequisites** are trees of courses (with optional minimum grades), class standing, and conditions software can't check (instructor permission, program restrictions). Those conditions are assumed met but flagged. Program policies such as "C or higher in prerequisites for CSE courses" apply on top. When planning a future term, in-progress courses are assumed to be passed.
- **The program audit** walks each requirement's rule tree. Requirements without open choices go first; "choose" requirements go after any requirements they reference, so "electives may not reuse item 2 courses" works. Each course counts once within a major. `anyOf` keeps whichever alternative is furthest along. Grade policies reject courses below the minimum and report why. Residency and group-GPA policies are checked after allocation. Substitutions that need no approval apply automatically. `unparsed` rules show as "needs review".
- **SBC and credits** are checked separately. SBC objectives match course tags and may overlap with major courses; program exemptions (for example LANG for engineering majors) apply. Credit totals cover the 120-credit and 39 upper-division-credit rules.
- **The next-semester proposal** turns what's missing into needs. It treats courses rejected by a grade policy as retakes and filters to eligible courses (prerequisites met, typically offered that season). It ranks them by required > SBC > elective, with bonuses for courses that unlock others or appear in the catalog's sample sequence, and fills greedily to 15 credits (18 at most). This is a heuristic, not an optimizer.
- **The graduation estimate** divides remaining credits by 15 per semester. It ignores prerequisite chains, so the UI labels it as rough.

## Status

| Area | State |
| --- | --- |
| App shell and navigation | Done |
| Dashboard | Done: real CS BS requirements, demo courses and student |
| Course explorer | Placeholder |
| My Courses + transcript upload | Done |
| Degree progress page | Done: full audit, program rules, SBC, catalog text |
| Semester planner | Placeholder (next-semester proposal already exists) |
| Real course catalog (`courses.json`) | Not started; demo course data until then |
