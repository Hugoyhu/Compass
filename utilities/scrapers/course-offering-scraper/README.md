# SemesterOS — Stony Brook PeopleSoft course catalog scraper

This kit uses Playwright to operate the **public PeopleSoft Browse Course Catalog UI**. It collects the course index and visible course-detail fields, optionally follows **View Class Sections** for a specified term, and exports the results as JSON, CSV, raw HTML, and a ZIP bundle. It does not log in, call undocumented endpoints, reuse saved session tokens, or bypass access controls.

## 1. Setup

Requires Python 3.10+. Run from this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python -m playwright install chromium
```

## 2. Recommended first live test

Keep the browser visible so you can observe the UI automation:

```bash
python scrape_catalog.py --letters A --max-details 3 --output semesteros-data-test --no-resume
```

Confirm that it selects `A`, expands subject groups, opens a course, returns to the catalog, and writes the output files. Live behavior still depends on PeopleSoft's current UI.

## 3. Full catalog run: A–Z, then 0–9

The default now processes the alphabet buttons in this order: `A B ... Z 0 1 ... 9`. It visits each group, expands the subject/course list, visits each course detail, and then generates exports.

```bash
python scrape_catalog.py --output semesteros-data
```

To also collect section/class-number and meeting information for a specific term, such as Spring 2027:

```bash
python scrape_catalog.py --sections-term "Spring 2027" --output semesteros-data
```

The section step is term-specific. Choose the term you want; do not treat one term's sections as proof of future offerings. For the first full run, it is sensible to test a few courses with `--max-details 3` first.

Useful options:

- `--letters A-Z-0-9` — all groups (default).
- `--letters A-Z` — letters only.
- `--letters 0-9` — numeric groups only.
- `--letters C,0,1` — selected groups.
- `--max-details 3` — smoke test; `0` means no limit.
- `--index-only` — collect course index pages only, no course detail pages.
- `--sections-term "Spring 2027"` — also scrape sections for the chosen term.
- `--headless` — hide the browser after the visible UI flow has been verified.
- `--no-resume` — revisit details even if they were collected before. Normally, reruns resume and avoid duplicate course/section rows.
- `--output PATH` — choose the output directory.
- `--delay-ms 700` — increase waits if PeopleSoft is slow.

The scraper pauses every 50 newly processed course details by default. Adjust with `--pause-every` and `--pause-seconds`; use `--pause-every 0` to disable the periodic pause. A Ctrl+C interruption preserves completed rows, and rerunning with the same output folder resumes.

## 4. Exports

The run creates:

```text
semesteros-data/
  course-index.json          # all indexed catalog entries
  course-index.csv
  course-details.jsonl        # one course detail record per line
  course-details.json         # same records as a JSON array
  course-details.csv
  course-sections.jsonl       # section records, if section collection is used
  course-sections.json
  course-sections.csv
  export-summary.json         # counts, term, and run metadata
  semesteros-export.zip      # bundle of exports, per-group indexes, and raw captures
  index/                      # index JSON split by letter/digit group
  raw/index/                  # captured index HTML
  raw/details/                # captured detail and section HTML
```

CSV columns are the union of fields present in the records; nested values are JSON-encoded in a cell. The ZIP includes the raw HTML so you can re-parse fields later if the parser improves. It excludes itself.

## 5. Offline parser

```bash
python parse_people_soft.py index 'Pasted text.txt' -o sample-index.json
python parse_people_soft.py detail 'Pasted text(1).txt' -o sample-detail.json
```

## 6. Import into the app catalog

From the repo root:

```bash
npm run import:courses               # data/ → data/catalog/courses.json + offerings/<term>.json + import-report.md
npm run import:courses -- --no-model # rules only, no API calls
```

- `enrollment.ts` splits each page's text blob into prerequisite, corequisite, advisory, and anti-requisite text, plus SBC tags and the SBC minimum grade.
- `prereq-rules.ts` parses common prerequisite shapes in code. `prereq-llm.ts` sends the rest to Claude Haiku 5.5 (`ANTHROPIC_API_KEY` from the repo-root `.env`). A tree that names a course not in its text is rejected. Results are cached in `prereq-cache.json`, so reruns are free; `--budget` (USD, default 3) caps spending.
- Sections are filed by the term their dates fall in (Jan–Apr Spring, May–Jul Summer, Aug–Dec Fall), not the scraper's term label. SUNY Korea sections (session `SGB` or a Korea room) are marked `campus: "korea"`.
- Only undergraduate courses (and their sections) are imported. Read `import-report.md` after each run.

## Data-quality and usage cautions

- A missing prerequisite field means **unknown**, not “no prerequisite.”
- A catalog course entry is not proof that it is offered in a given term.
- Numeric catalog buttons are processed after A–Z because the PeopleSoft UI exposes `0` through `9` separately. Empty groups are saved as empty per-group index files and recorded in the run log.
- Some catalog identifiers are nonstandard. Preserve them and review parser output rather than assuming every identifier is a numeric course number.
- Validate the parsed details against several known courses and review the run log for skipped or timed-out items before treating the dataset as complete.
- Retain the raw HTML, note the collection date, and verify degree rules against the relevant official Bulletin year.
- Use the public UI responsibly. Stop if the site presents an access restriction or unexpected behavior.


## Parallel scraping (multiple independent browser sessions)

The default run is sequential. To parallelize across alphabet/numeric groups, use `--workers`. Each worker launches its own scraper process and isolated browser session, then merges the outputs. Start with 4 workers; up to 13 are supported, but higher concurrency may trigger PeopleSoft timeouts or throttling.

```bash
# Recommended first parallel run
python scrape_catalog.py --workers 4 --output semesteros-data

# Request 13 independent browser workers
python scrape_catalog.py --workers 13 --output semesteros-data

# Parallel run including term-specific class sections
python scrape_catalog.py --workers 4 --sections-term "Spring 2027" --output semesteros-data
```

Parallel mode partitions the requested letter/digit groups between workers, gives each worker its own output directory and browser session, merges JSONL/JSON data, and writes one final export. Worker logs are retained in `semesteros-data/logs/`. `--max-details` is intentionally disallowed with multiple workers because it is designed for a single-worker smoke test. Resume mode is supported by seeding workers with existing detail/section JSONL files. For the first run, test with 2–4 workers before requesting 13.
