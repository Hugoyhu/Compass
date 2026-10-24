# Compass

A prerequisite-aware degree audit and semester planner for Stony Brook University students. Built as a hackathon MVP.

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

## Database and accounts

Postgres, currently hosted on Tiger Data. Everything is plain PostgreSQL, so the same code and migrations run on Supabase or any Postgres.

```bash
npm run db:migrate   # apply db/migrations/*.sql (add -- --tiger for Tiger-only extras, when they exist)
npm run db:load      # load data/catalog into the database; rerun whenever the JSON changes
```

Environment variables (`.env` locally, the host's settings in production):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Without it the app runs guest-only and reads the catalog from files. |
| `DATA_SOURCE` | `postgres` to read the catalog from the database; `files` (default) to read `data/catalog/` directly. |
| `DATABASE_PREPARE` | `true` only for direct connections that support prepared statements; leave unset for poolers. |
| `ANTHROPIC_API_KEY` | Transcript reading. |

- **The JSON files in `data/catalog/` stay the source of truth.** The database is a loaded copy, so moving providers means running migrate and load against the new database, then changing `DATABASE_URL`.
- **Catalog reads are cached** (`use cache`, one hour), so pages don't query the database on every request. After `db:load`, a running deployment picks up the new data within the hour, or immediately on redeploy (restart `npm run dev` locally). Building with `DATA_SOURCE=postgres` needs the database to be reachable.
- **Section data is incomplete**, because the scraper timed out on some courses. The planner treats a course with a section in the target term as "confirmed" and anything else as "unconfirmed", never "not offered".
- **Accounts** use a username and password; there's no email and no password reset. Passwords are hashed with scrypt. Sessions are random tokens in an httpOnly cookie, and only a SHA-256 hash of each token is stored. Every Server Action re-checks the session, and sign-in and sign-up are rate-limited.
- **Signing up or signing in** moves a guest's browser record into the account, if the account doesn't already have one.

## Student records

- **Storage:** a signed-in student's record (courses, grades, AP/transfer credit, major, current term) is stored in the database. A guest's record is stored only in their browser, as compact cookies split into chunks. Either way, server components run the audit with the visitor's data.
- **Semester Planner** (`/planner`): a term-by-term plan stored with the record (run `npm run db:migrate` to add its columns). "Generate" fills the empty fall/spring semesters of a four-year degree and never changes terms already planned: each term takes the courses the student's programs need (or missing prerequisites that unlock them) that run that season, lowest-numbered first, with the student's program order breaking ties and chains like CSE 495 → 496 moved up when time runs short; SBC placeholders and electives fill the rest up to the term's share of the remaining credits. "Runs that season" comes from that season's most recent schedule; a season whose schedule is only a partial scrape (currently fall) doesn't rule anything out. Each term is checked for prerequisites, credit load, and whether courses are on that term's schedule.
- **My Courses** (`/record`): add, edit, and remove courses, choose a major, upload a transcript, or clear the record.
- **Transcript upload:** Claude Haiku 5.5 reads the PDF and transcribes course rows into a small flat schema (structured outputs). Plain code then interprets them: AP code suffixes, grades, terms, in-progress detection, printed SBC tags. The student reviews every course before saving. The PDF isn't stored, and ID numbers are never extracted. The fictional fixture in `tests/fixtures/transcript/` mirrors the real layout; never commit real transcripts.

## Catalog data

Real catalog data lives in `data/catalog/` and is validated against the Zod schemas in `lib/domain/catalog/`:

- `programs/*.json`: one `ProgramDefinition` per major. `cse-bs.json` is hand-encoded from the Fall 2026 Undergraduate Catalog and is the reference answer for automated extraction.
- `courses.json`: an array of `CourseRecord`, written by `npm run import:courses`.

The app loads every valid file in `programs/` at startup; invalid files are skipped with a warning. Without a valid `courses.json` the app starts with no courses and logs a warning.

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
    repository.ts         Data access interface (files or Postgres)
    sbc.ts                SBC categories and university credit rules
  engine/                 Pure planning logic, with no React or I/O
    prerequisites.ts      Evaluate prerequisite expressions and grade floors
    audit.ts              Match coursework to requirements
    planner.ts            Next-term prerequisite checks and graduation estimate
    describe.ts           Plain-language summaries of audit results
  services/               Compose repository and engine into page view models
```

### Design rules

- **Logic stays out of components.** Audit and planning live in `lib/engine` as pure functions. Components only receive results.
- **One data boundary.** Pages reach data only through `getRepository()`. To use real catalog data, write another `CompassRepository` implementation and return it from `getRepository()`. Nothing else needs to change.

## How the engine works

- **Prerequisites** are trees of courses (with optional minimum grades), class standing, and conditions software can't check (instructor permission, program restrictions). Those conditions are assumed met but flagged. Program policies such as "C or higher in prerequisites for CSE courses" apply on top. When planning a future term, in-progress courses are assumed to be passed.
- **The program audit** walks each requirement's rule tree. Requirements without open choices go first; "choose" requirements go after any requirements they reference, so "electives may not reuse item 2 courses" works. Each course counts once within a major. `anyOf` keeps whichever alternative is furthest along. Grade policies reject courses below the minimum and report why. Residency and group-GPA policies are checked after allocation. Substitutions that need no approval apply automatically. `unparsed` rules show as "needs review".
- **SBC and credits** are checked separately. SBC objectives match course tags and may overlap with major courses; program exemptions (for example LANG for engineering majors) apply. Credit totals cover the 120-credit and 39 upper-division-credit rules.
- **The graduation estimate** divides remaining credits by 15 per semester. It ignores prerequisite chains, so the UI labels it as rough.

## Status

| Area | State |
| --- | --- |
| App shell and navigation | Done |
| Dashboard | Done: real requirements and course data; next semester shows the sections picked in the Schedule Builder |
| Course explorer | Placeholder |
| My Courses + transcript upload | Done |
| Degree progress page | Done: full audit, program rules, SBC, catalog text |
| Semester planner | Placeholder (next-semester proposal already exists) |
| Database (Tiger Data) and accounts | Done |
| Real course catalog and term sections | Done (PeopleSoft import); some subjects and sections missing, see the scraper's `import-report.md` |
