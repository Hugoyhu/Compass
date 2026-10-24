/**
 * Downloads every major and minor page from the catalog into data/raw/programs.
 *
 *   npm run scrape:programs:fetch            # all programs, skipping saved pages
 *   npm run scrape:programs:fetch -- --limit=5
 *
 * The catalog site answers plain HTTP clients with an empty 202 (a bot
 * challenge), so this drives a real headless Chrome via playwright-core.
 * It uses your installed Google Chrome; no browser download needed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { CATALOG, RAW_DIR, RAW_INDEX, REQUEST_DELAY_MS, type RawProgramEntry } from "./config";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function load(page: Page, url: string, readySelector: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The bot challenge resolves with a reload; wait for real content.
  await page.waitForSelector(readySelector, { timeout: 60_000 });
}

async function discoverPrograms(page: Page) {
  const found = new Map<number, Omit<RawProgramEntry, "file" | "fetchedAt">>();
  for (const { kind, navoid } of CATALOG.listings) {
    await load(page, `${CATALOG.origin}/content.php?catoid=${CATALOG.catoid}&navoid=${navoid}`, 'a[href*="preview_program.php"]');
    const links = await page.$$eval('a[href*="preview_program.php"]', (anchors) =>
      anchors.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim() ?? "" })),
    );
    for (const { href, text } of links) {
      const poid = Number(new URL(href).searchParams.get("poid"));
      if (!poid || found.has(poid)) continue;
      found.set(poid, {
        poid,
        name: text,
        kind,
        url: `${CATALOG.origin}/preview_program.php?catoid=${CATALOG.catoid}&poid=${poid}`,
      });
    }
    console.log(`${kind}s: ${links.length} links`);
    await sleep(REQUEST_DELAY_MS);
  }
  return [...found.values()];
}

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  mkdirSync(RAW_DIR, { recursive: true });
  const index: RawProgramEntry[] = existsSync(RAW_INDEX) ? JSON.parse(readFileSync(RAW_INDEX, "utf8")) : [];
  const saved = new Map(index.map((e) => [e.poid, e]));

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const programs = await discoverPrograms(page);
    console.log(`Discovered ${programs.length} programs`);

    let fetched = 0;
    for (const program of programs) {
      if (fetched >= limit) break;
      const file = `${program.poid}.html`;
      if (saved.has(program.poid) && existsSync(path.join(RAW_DIR, file))) continue;

      await load(page, program.url, "h1");
      writeFileSync(path.join(RAW_DIR, file), await page.content());
      saved.set(program.poid, { ...program, file, fetchedAt: new Date().toISOString().slice(0, 10) });
      // Write the index after every page so an interrupted run resumes cleanly.
      writeFileSync(RAW_INDEX, JSON.stringify([...saved.values()], null, 2) + "\n");
      fetched++;
      console.log(`  [${fetched}] ${program.kind} ${program.name}`);
      await sleep(REQUEST_DELAY_MS);
    }
    console.log(`Done: ${fetched} fetched, ${saved.size} saved in total`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
