/**
 * Measures extraction quality against the hand-encoded Computer Science BS.
 *
 *   npm run scrape:programs:eval
 *   npm run scrape:programs:eval -- --model=claude-sonnet-5-5 --effort=high
 *
 * The answer key is NOT included in the prompt (zero-shot), so this measures
 * how the extractor does on a program it has never seen. Pass bar: at least
 * 8 of 9 requirement rules and all policies match.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ProgramPolicy, Rule } from "@/lib/domain/catalog/program";
import { CATALOG, DEFAULT_MODEL, GOLD_FILE, RAW_DIR, SCRAPER_DIR, loadEnv } from "./config";
import { extractProgram, type ExtractOptions } from "./extractor";
import { programHtmlToText } from "./html-to-text";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

/** Canonical form: drop provenance and ids, sort order-insensitive arrays. */
function normalizeRule(rule: Rule): unknown {
  const rest = { ...rule };
  delete rest.sourceText;
  delete rest.id;
  delete rest.manualCheck;
  if (rest.type === "allOf" || rest.type === "anyOf") {
    const rules = rest.rules.map(normalizeRule).map((r) => JSON.stringify(r)).sort();
    return { type: rest.type, rules };
  }
  return JSON.parse(JSON.stringify(rest, (_k, v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v].sort() : v)));
}

/** Rule ids nested inside requirements, mapped to their canonical rule. Requirement ids are fixed, so only these vary. */
function nestedRuleIds(program: { requirements: { rule: Rule }[] }): Map<string, string> {
  const ids = new Map<string, string>();
  const visit = (rule: Rule) => {
    if (rule.id) ids.set(rule.id, JSON.stringify(normalizeRule(rule)));
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
  };
  program.requirements.forEach((r) => visit(r.rule));
  return ids;
}

/** Canonical form; appliesTo entries naming a nested rule compare by that rule's content, not its id. */
function normalizePolicy(policy: ProgramPolicy, ruleIds: Map<string, string>): string {
  const rest: Partial<ProgramPolicy> = { ...policy };
  delete rest.sourceText;
  if ("appliesTo" in rest && rest.appliesTo) rest.appliesTo = rest.appliesTo.map((id) => ruleIds.get(id) ?? id);
  return JSON.stringify(rest, (_k, v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v].sort() : v));
}

async function main() {
  loadEnv();
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8"));
  const htmlFile = path.join(RAW_DIR, `${CATALOG.goldPoid}.html`);
  if (!existsSync(htmlFile)) throw new Error(`Missing ${htmlFile}. Run npm run scrape:programs:fetch first.`);

  const options: ExtractOptions = {
    model: arg("model") ?? DEFAULT_MODEL,
    effort: (arg("effort") as ExtractOptions["effort"]) ?? "medium",
  };
  console.log(`Extracting Computer Science, BS with ${options.model} (effort ${options.effort}), zero-shot...`);

  const client = new Anthropic({ maxRetries: 4 });
  const result = await extractProgram(
    client,
    { id: gold.id, name: gold.name, kind: gold.kind },
    programHtmlToText(readFileSync(htmlFile, "utf8")),
    options,
  );
  console.log(`Attempts: ${result.attempts}, cost: $${result.costUsd.toFixed(4)}`);
  if (!result.program) {
    console.log(`✗ Extraction failed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }

  const outDir = path.join(SCRAPER_DIR, "eval-output");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `cse-bs.${options.model}.json`);
  writeFileSync(outFile, JSON.stringify(result.program, null, 2) + "\n");

  const extracted = new Map(result.program.requirements.map((r) => [r.label, r]));
  let matched = 0;
  for (const req of gold.requirements) {
    const got = extracted.get(req.label);
    const same = got && JSON.stringify(normalizeRule(got.rule)) === JSON.stringify(normalizeRule(req.rule));
    if (same) matched++;
    console.log(`${same ? "✓" : "✗"} requirement ${req.label}: ${req.title}${got ? "" : " (missing)"}`);
  }

  const goldIds = nestedRuleIds(gold);
  const gotIds = nestedRuleIds(result.program);
  const goldPolicies = gold.policies.map((p: ProgramPolicy) => normalizePolicy(p, goldIds));
  const gotPolicies = result.program.policies.map((p) => normalizePolicy(p, gotIds));
  const policyMatches = goldPolicies.filter((p: string) => gotPolicies.includes(p)).length;
  for (const p of goldPolicies) if (!gotPolicies.includes(p)) console.log(`✗ missing policy ${p}`);
  for (const p of gotPolicies) if (!goldPolicies.includes(p)) console.log(`! extra policy ${p}`);

  const pass = matched >= gold.requirements.length - 1 && policyMatches === goldPolicies.length;
  console.log(
    `\nRequirements ${matched}/${gold.requirements.length}, policies ${policyMatches}/${goldPolicies.length}, ` +
      `substitutions ${result.program.substitutions.length}/${gold.substitutions.length} → ${pass ? "PASS" : "FAIL"}`,
  );
  console.log(`Output: ${path.relative(process.cwd(), outFile)} (diff it against ${path.relative(process.cwd(), GOLD_FILE)})`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
