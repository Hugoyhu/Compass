/**
 * Extracts every saved program page into data/catalog/programs/<slug>.json.
 *
 *   npm run scrape:programs:extract -- --limit=3          # try a few first
 *   npm run scrape:programs:extract                       # everything left
 *   npm run scrape:programs:extract -- --only=1349        # one program by poid
 *
 * Flags: --model, --effort, --concurrency (default 3), --budget (USD, default 5),
 * --force (re-extract programs that already have output).
 *
 * Programs already hand-encoded (review.extractedBy "hand") are skipped.
 * Failures are written to data/catalog/failed/ with their errors.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ProgramDefinition } from "@/lib/domain/catalog/program";
import {
  CATALOG,
  DEFAULT_MODEL,
  FAILED_DIR,
  GOLD_FILE,
  PROGRAMS_DIR,
  RAW_DIR,
  RAW_INDEX,
  RUN_LOG,
  loadEnv,
  type RawProgramEntry,
  type RunLog,
} from "./config";
import { extractProgram, type ExtractOptions } from "./extractor";
import { programHtmlToText } from "./html-to-text";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  loadEnv();
  const options: ExtractOptions = {
    model: arg("model") ?? DEFAULT_MODEL,
    effort: (arg("effort") as ExtractOptions["effort"]) ?? "medium",
  };
  const budget = Number(arg("budget") ?? 5);
  const concurrency = Number(arg("concurrency") ?? 3);
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const only = arg("only");
  const force = process.argv.includes("--force");

  const index: RawProgramEntry[] = JSON.parse(readFileSync(RAW_INDEX, "utf8"));
  const existing = readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(PROGRAMS_DIR, f), "utf8")) as ProgramDefinition);
  const handEncoded = new Set(existing.filter((p) => p.review.extractedBy === "hand").map((p) => p.name));

  // The hand-encoded CS BS is the worked example in the cached prompt prefix.
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8"));
  const goldHtml = path.join(RAW_DIR, `${CATALOG.goldPoid}.html`);
  if (existsSync(goldHtml)) {
    const goldJson = { ...gold };
    delete goldJson.source;
    delete goldJson.review;
    options.example = { pageText: programHtmlToText(readFileSync(goldHtml, "utf8")), json: goldJson };
  } else {
    console.log("! CS BS page not fetched; extracting without a worked example");
  }

  const queue = index
    .filter((e) => (only ? String(e.poid) === only || slugify(e.name) === only : true))
    .filter((e) => !handEncoded.has(e.name))
    .filter((e) => force || !existsSync(path.join(PROGRAMS_DIR, `${slugify(e.name)}.json`)))
    .slice(0, limit);
  console.log(`${queue.length} programs to extract with ${options.model}, budget $${budget}`);

  mkdirSync(FAILED_DIR, { recursive: true });
  const client = new Anthropic({ maxRetries: 4 });
  let spent = 0;
  let succeeded = 0;
  let failed = 0;
  const log: RunLog = { model: options.model, startedAt: new Date().toISOString(), budgetUsd: budget, spentUsd: 0, skipped: 0, programs: [] };

  async function worker() {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      if (spent >= budget) return;
      const id = slugify(entry.name);
      const pageText = programHtmlToText(readFileSync(path.join(RAW_DIR, entry.file), "utf8"));
      try {
        const result = await extractProgram(client, { id, name: entry.name, kind: entry.kind }, pageText, options);
        spent += result.costUsd;
        log.programs.push({
          id,
          name: entry.name,
          kind: entry.kind,
          ok: Boolean(result.program),
          attempts: result.attempts,
          costUsd: result.costUsd,
          error: result.errors[0]?.split("\n")[0],
        });
        if (result.program) {
          const program: ProgramDefinition = {
            ...result.program,
            source: { catalog: CATALOG.name, url: entry.url, fetchedAt: entry.fetchedAt },
            review: { status: "draft", extractedBy: options.model },
          };
          writeFileSync(path.join(PROGRAMS_DIR, `${id}.json`), JSON.stringify(program, null, 2) + "\n");
          rmSync(path.join(FAILED_DIR, `${id}.json`), { force: true });
          succeeded++;
          console.log(`✓ ${entry.name} ($${result.costUsd.toFixed(4)}, total $${spent.toFixed(2)})`);
        } else {
          writeFileSync(path.join(FAILED_DIR, `${id}.json`), JSON.stringify({ entry, errors: result.errors }, null, 2) + "\n");
          failed++;
          console.log(`✗ ${entry.name}: ${result.errors[0]?.split("\n")[0]}`);
        }
      } catch (error) {
        failed++;
        log.programs.push({ id, name: entry.name, kind: entry.kind, ok: false, attempts: 0, costUsd: 0, error: (error as Error).message });
        console.log(`✗ ${entry.name}: ${(error as Error).message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  log.spentUsd = spent;
  log.skipped = queue.length;
  writeFileSync(RUN_LOG, JSON.stringify(log, null, 2) + "\n");
  if (spent >= budget && queue.length > 0) console.log(`! Stopped at the $${budget} budget with ${queue.length} left`);
  console.log(`Done: ${succeeded} succeeded, ${failed} failed, $${spent.toFixed(2)} spent`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
