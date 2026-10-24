/**
 * End-to-end check of transcript extraction against the fictional fixture.
 *
 *   npm run test:transcript                 # fixture, with assertions
 *   npm run test:transcript -- path/to.pdf  # any PDF; prints the draft only
 *
 * Calls the Claude API once (Haiku, well under a cent). Never commit real
 * transcripts; pass them by path from outside the repo.
 */
import { existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { extractTranscript, normalizeTranscript } from "@/lib/transcript/extract";

const FIXTURE = "tests/fixtures/transcript/sample-transcript.pdf";

/** Expected attempts in the fixture: code → [source, grade or "", status, credits]. */
const EXPECTED: Record<string, [string, string, string, number]> = {
  "PSY 103": ["transfer", "B+", "completed", 3],
  "CHE 131": ["ap", "T", "completed", 4],
  "CHE 133": ["ap", "T", "completed", 0],
  "CSE 114": ["ap", "T", "completed", 4],
  "MAT 131": ["ap", "T", "completed", 4],
  "MAT 132": ["ap", "T", "completed", 4],
  "PHY 125": ["ap", "T", "completed", 3],
  "CSE 113": ["sbu", "A-", "completed", 4],
  "AMS 210": ["sbu", "B", "completed", 3],
  "WRT 102": ["sbu", "A", "completed", 3],
  "HIS 104": ["sbu", "W", "completed", 3],
  "CSE 214": ["sbu", "", "in-progress", 4],
  "CSE 213": ["sbu", "", "in-progress", 4],
  "HON 105": ["sbu", "", "in-progress", 3],
  "EXT 288": ["sbu", "", "in-progress", 0],
};

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const file = process.argv[2] ?? FIXTURE;
  const isFixture = file === FIXTURE;

  const started = Date.now();
  const { extraction, costUsd } = await extractTranscript(new Anthropic(), readFileSync(file).toString("base64"));
  const draft = normalizeTranscript(extraction);
  console.log(`Read in ${((Date.now() - started) / 1000).toFixed(1)}s, $${costUsd.toFixed(4)}`);
  console.log(`Plan: ${draft.plan}; current term: ${draft.currentTerm}; ${draft.attempts.length} courses`);
  for (const a of draft.attempts) {
    console.log(`  ${a.code.padEnd(8)} ${a.source.padEnd(8)} ${(a.term ?? "").padEnd(7)} ${(a.grade ?? "").padEnd(3)} ${a.status.padEnd(11)} ${a.credits} cr ${a.sbc?.join(",") ?? ""}`);
  }
  draft.warnings.forEach((w) => console.log(`  ! ${w}`));
  if (!isFixture) return;

  // Assertions for the fixture.
  const failures: string[] = [];
  const byCode = new Map(draft.attempts.map((a) => [a.code, a]));
  for (const [code, [source, grade, status, credits]] of Object.entries(EXPECTED)) {
    const a = byCode.get(code);
    if (!a) failures.push(`missing ${code}`);
    else if (a.source !== source || (a.grade ?? "") !== grade || a.status !== status || a.credits !== credits) {
      failures.push(`${code}: got ${a.source}/${a.grade ?? ""}/${a.status}/${a.credits}, expected ${source}/${grade}/${status}/${credits}`);
    }
  }
  if (draft.attempts.length !== Object.keys(EXPECTED).length) failures.push(`expected ${Object.keys(EXPECTED).length} courses, got ${draft.attempts.length}`);
  if (byCode.get("WRT 102")?.sbc?.join() !== "WRT") failures.push("WRT 102 should carry the WRT attribute");
  if (byCode.get("HON 105")?.sbc?.join() !== "CER") failures.push("HON 105 should carry the CER attribute");
  if (byCode.get("CSE 113")?.term !== "2025-FA") failures.push("CSE 113 should be in 2025-FA");
  if (draft.currentTerm !== "2026-SP") failures.push(`current term should be 2026-SP, got ${draft.currentTerm}`);
  if (draft.plan !== "Computer Science Major") failures.push(`plan should be "Computer Science Major", got ${draft.plan}`);
  if (JSON.stringify(draft).includes("000000000")) failures.push("the student ID leaked into the output");

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\n✓ Fixture extracted correctly");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
