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

Only one tool in this application relies on an AI API, namely, to upload a transcript. The PDF is passed to Claude API (Haiku 5.5), and you'll need `ANTHROPIC_API_KEY=...` in your `.env`, which is gitignored. The app will work without this functionality, but you will need to manually import classes instead.

## Database and accounts

Postgres for this project is hosted on Tiger Data.

```bash
npm run db:migrate   # apply db/migrations/*.sql (add -- --tiger for Tiger-only extras, when they exist)
npm run db:load      # load data/catalog into the database; rerun whenever the JSON changes
```

Environment variables (`.env` locally, the host's settings in production):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Without it the app runs guest-only and reads the catalog from files. |
| `ANTHROPIC_API_KEY` | Transcript reading. |

- **Accounts** use a username and password; there's no email and no password reset. Passwords are hashed with scrypt. Sessions are random tokens in an httpOnly cookie, and only a SHA-256 hash of each token is stored. Every Server Action re-checks the session, and sign-in and sign-up are rate-limited.
- **Signing up or signing in** moves a guest's browser record into the account, if the account doesn't already have one.

## Student records

- **Storage:** a signed-in student's record (courses, grades, AP/transfer credit, major, current term) is stored in the database. A guest's record is stored only in their browser, as compact cookies split into chunks.
- **Semester Planner** (`/planner`): a term-by-term plan is mapped out for an intended graduation semester. Right now, only fall/spring sessions are supported.
- **My Courses** (`/record`): add, edit, and remove courses, choose a major, upload a transcript, or clear the record.
- **Transcript upload:** Claude Haiku 5.5 parses the PDF and transcribes attempted course rows into a flat schema, then interpreted by code for SBCs, grades, terms, whether a class is in-progress, and more. Suggestions must be reviewed for accuracy before saving. You can redact all personally identifying information on your transcript.

## Catalog data

Real catalog data lives in `data/catalog/` and is validated against the Zod schemas in `lib/domain/catalog/`:

- `programs/*.json`: one `ProgramDefinition` per major.
- `courses.json`: an array of `CourseRecord`, written by `npm run import:courses`.
- `professors.json`: Rate My Professors ratings, written by `npm run scrape:ratings` and matched to instructors by name in the Schedule Builder. Optional; without it no ratings show.

The app loads every valid file in `programs/` at startup; invalid files are skipped with a warning. Without a valid `courses.json` the app starts with no courses and logs a warning.

Rule trees are recursive, but Claude structured outputs reject recursive JSON Schemas. `programExtractionJsonSchema()` produces an unrolled, depth-limited schema (with shared parts under `$defs`) that accepts the same JSON.

To populate `data/catalog/programs/` from the live catalog (PeopleSoft), use the scraper in [utilities/scrapers/major-minor/](utilities/scrapers/major-minor/README.md). It uses headless Chrome to fetch pages (the site blocks plain HTTP clients) and Claude Haiku 5.5 to extract them.

## Stack

- Next.js 16 (App Router, Turbopack, Cache Components enabled)
- React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui (`base-nova` style, built on Base UI, so components take `render` props instead of `asChild`)

## Logo

I made a quick mockup of the Compass logo on Figma.

## How the engine works

- **Prerequisites** are trees of courses, considering minimum grades, class standings, and other conditions. Some of these prerequisites are advisory (and assumed met), while others (like prerequisite courses) are enforced.
- **The program audit** walks each requirement's rule tree. Requirements without open choices go first; "choose" requirements go after any requirements they reference, so "electives may not reuse item 2 courses" works. Each course counts once within a major. `anyOf` keeps whichever alternative is furthest along. Grade policies reject courses below the minimum and report why. Residency and group-GPA policies are checked after allocation. Substitutions that need no approval apply automatically. `unparsed` rules show as "needs review".
- **SBC and credits** are checked separately. SBC objectives match course tags and may overlap with major courses; program exemptions (for example LANG for engineering majors) apply. Credit totals cover the 120-credit and 39 upper-division-credit rules.
- **The graduation estimate** divides remaining credits by 15 per semester. It ignores prerequisite chains, so the UI labels it as rough.

## Acknowledgements and Notes

The most tentative part of this project was in data collection. Stony Brook offers a (thankfully) publicly-facing PeopleSoft session for course catalog and session information. I was able to work with GPT-5.6 to analyze the XML records from PeopleSoft, and GPT was able to create a scraping utility to operate the PeopleSoft system through headless Chromium instances. Opus-5.5 was able to take the work produced by GPT-5.6 and deliver QOL improvements to ensure improvements in scraping reliability and speed.

As Compass is a solo-hackathon project designed under time restraints (and a stubbornness not to pull all-nighters), this MVP and proof-of-concept is assisted with Agentic AI development tools, namely Claude Code with models Opus-5.5 and Sonnet-5.5, as well as GitHub Copilot with GPT-5.6 Luna.
