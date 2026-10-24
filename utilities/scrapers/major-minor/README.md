# Major and minor scraper

Turns every major and minor page in the Stony Brook Fall 2026 Undergraduate Catalog into a validated `ProgramDefinition` JSON file in `data/catalog/programs/`.

Fetching is plain code (headless Chrome). Reading the page and producing JSON is Claude Haiku 5.5 through the API. The JSON Schema is in the prompt, and every response is checked with the Zod schemas.

## Setup

1. Google Chrome must be installed. The fetcher drives it through `playwright-core`.
2. Put the API key in `.env` at the repo root (or in `utilities/scrapers/major-minor/.env`, which wins if both exist):

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   `.env*` files are gitignored, so the key never gets committed.

## Steps

Run everything from the repo root.

```bash
npm run scrape:programs:fetch      # 1. download pages → data/raw/programs (no API cost)
npm run scrape:programs:eval       # 2. score the extractor on the CS BS (a fraction of a cent)
npm run scrape:programs:extract -- --limit=3   # 3. try a few programs and read the output
npm run scrape:programs:extract    # 4. extract everything left (stops at --budget, default $5)
npm run validate:catalog           # 5. re-check all output
```

Or run steps 4 and 5 in one go: `npm run scrape:programs:run` extracts (it takes the same flags as extract), validates, and writes `run-report.md` with successes, failures, cost, and `unparsed` counts per program.

- **fetch** discovers programs from the catalog's Majors and Minors pages, then saves each page once. Rerunning skips pages already saved. The catalog blocks plain HTTP clients, which is why it needs a real browser.
- **eval** extracts the Computer Science BS *without* showing the model the hand-encoded answer key, then compares the result to `data/catalog/programs/cse-bs.json`. It passes at 8 or more of 9 requirements matching and all policies matching. Output goes to `eval-output/` for diffing.
- **extract** uses the CS BS page and its JSON as a worked example in a cached prompt prefix. It validates every result, retries once with the errors, and writes failures to `data/catalog/failed/`. Programs that already have output are skipped unless you pass `--force`. Hand-encoded programs are always skipped.

Common flags: `--model=claude-sonnet-5-5`, `--effort=low|medium|high`, `--only=<poid or slug>`, `--concurrency=3`, `--budget=5`.

## Files

| File | Purpose |
|---|---|
| `config.ts` | Catalog ids, paths, model pricing, `.env` loading |
| `fetch.ts` | Program discovery and page download |
| `html-to-text.ts` | Page HTML → compact text that keeps list and table structure |
| `prompt.ts` | Extraction instructions and the worked-example wrapper |
| `extractor.ts` | API call, validation, one retry with errors |
| `eval.ts` | Scoring against the CS BS answer key |
| `extract.ts` | Bulk run with budget, concurrency, and resume |
| `run.ts` | Extract + validate + report (`run-report.md`) |

## Notes

- Extracted files are marked `review.status: "draft"`. A person should read a sample before the app relies on them.
- Structured outputs aren't used. The API rejects this schema with "compiled grammar is too large", even with rule trees cut to depth 1 and no optional fields. Instead, the full recursive schema goes in the cached system prompt, and the Zod schema validates each result, with one retry on errors.
- The eval compares policies by the rule they point to, not by the rule's id, since ids like `cse-bs.2.capstone` are free-form names.
