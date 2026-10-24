/**
 * Full pipeline: extract every program, validate the catalog, write a report.
 *
 *   npm run scrape:programs:run
 *   npm run scrape:programs:run -- --force --concurrency=5
 *
 * Flags are passed through to extract.ts. The report goes to the console and
 * to run-report.md in this folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import { FAILED_DIR, PROGRAMS_DIR, RUN_LOG, SCRAPER_DIR, type RunLog } from "./config";

const REPORT_FILE = path.join(SCRAPER_DIR, "run-report.md");

function npm(script: string, args: string[] = [], capture = false) {
  const result = spawnSync("npm", ["run", "--silent", script, "--", ...args], {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** Counts rule nodes by type, plus manualCheck flags, across a program's rule trees. */
function ruleStats(program: ProgramDefinition) {
  const stats = { unparsed: 0, manualCheck: 0, nodes: 0 };
  const visit = (rule: Rule) => {
    stats.nodes++;
    if (rule.type === "unparsed") stats.unparsed++;
    if (rule.manualCheck) stats.manualCheck++;
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
  };
  program.requirements.forEach((r) => visit(r.rule));
  program.substitutions.forEach((s) => visit(s.with));
  program.sbc.fulfillment.forEach((f) => visit(f.rule));
  return stats;
}

function main() {
  const passthrough = process.argv.slice(2);

  console.log("== Extract");
  npm("scrape:programs:extract", passthrough);
  const log: RunLog | undefined = existsSync(RUN_LOG) ? JSON.parse(readFileSync(RUN_LOG, "utf8")) : undefined;

  console.log("\n== Validate");
  const validation = npm("validate:catalog", [], true);
  const problems = validation.stdout.split("\n").filter((line) => line.startsWith("✗") || line.startsWith("!"));
  problems.forEach((line) => console.log(line));

  const programs = readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(PROGRAMS_DIR, f), "utf8")) as ProgramDefinition);
  const failedFiles = existsSync(FAILED_DIR) ? readdirSync(FAILED_DIR).filter((f) => f.endsWith(".json")) : [];
  const rows = programs
    .map((p) => ({ program: p, ...ruleStats(p) }))
    .sort((a, b) => b.unparsed - a.unparsed || a.program.id.localeCompare(b.program.id));
  const totalUnparsed = rows.reduce((sum, r) => sum + r.unparsed, 0);
  const count = (kind: string) => programs.filter((p) => p.kind === kind).length;

  const lines: string[] = ["# Program extraction report", ""];
  if (log) {
    const ran = log.programs;
    const ok = ran.filter((p) => p.ok);
    const retried = ok.filter((p) => p.attempts > 1).length;
    lines.push(
      `Last extract run: ${log.startedAt} with ${log.model}`,
      "",
      `- Extracted: ${ok.length} of ${ran.length} attempted (${retried} needed the retry)`,
      `- Failed: ${ran.length - ok.length}`,
      `- Skipped by budget: ${log.skipped}`,
      `- Cost: $${log.spentUsd.toFixed(2)} of the $${log.budgetUsd} budget` +
        (ok.length ? `, $${(log.spentUsd / ran.length).toFixed(4)} per program on average` : ""),
      "",
    );
  }
  lines.push(
    "## Catalog",
    "",
    `- Programs on disk: ${programs.length} (${count("major")} majors, ${count("minor")} minors)`,
    `- Failure records in data/catalog/failed: ${failedFiles.length}`,
    `- validate:catalog: ${validation.status === 0 ? "passed" : "FAILED"}, ${problems.filter((l) => l.startsWith("✗")).length} errors, ${problems.filter((l) => l.startsWith("!")).length} warnings`,
    `- Unparsed rule nodes: ${totalUnparsed} across ${rows.filter((r) => r.unparsed > 0).length} programs`,
    `- Rule nodes flagged for manual check: ${rows.reduce((sum, r) => sum + r.manualCheck, 0)}`,
    "",
  );

  const failures = log?.programs.filter((p) => !p.ok) ?? [];
  if (failures.length > 0) {
    lines.push("## Failures", "", ...failures.map((f) => `- ${f.name}: ${f.error ?? "unknown error"}`), "");
  }
  if (problems.length > 0) {
    lines.push("## Validation problems", "", ...problems.map((p) => `- ${p}`), "");
  }
  lines.push(
    "## Programs by unparsed count",
    "",
    "| Program | Kind | Requirements | Unparsed | Manual check | Status |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.program.name} | ${r.program.kind} | ${r.program.requirements.length} | ${r.unparsed} | ${r.manualCheck} | ${r.program.review.status} (${r.program.review.extractedBy}) |`,
    ),
    "",
  );

  writeFileSync(REPORT_FILE, lines.join("\n"));
  console.log(`\n${lines.slice(0, lines.indexOf("## Programs by unparsed count")).join("\n")}`);
  console.log(`Full report: ${path.relative(process.cwd(), REPORT_FILE)}`);
}

main();
