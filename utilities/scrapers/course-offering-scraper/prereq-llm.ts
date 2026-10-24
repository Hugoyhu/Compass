/**
 * Prerequisite text → Prereq tree with Claude, for texts the plain-code rules
 * can't handle.
 *
 * Texts go in groups of GROUP_SIZE per request. Each tree must pass the Zod
 * schema and name only courses that appear in its text; anything that fails
 * is retried once on its own, then left without a tree. Successful trees are
 * cached in prereq-cache.json by text, so reruns cost nothing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PrereqSchema, type Prereq } from "@/lib/domain/catalog/course";
import { costOf } from "../major-minor/extractor";
import { codesIn } from "./enrollment";
import { treeCodes } from "./prereq-rules";

export const CACHE_FILE = path.resolve("utilities/scrapers/course-offering-scraper/prereq-cache.json");
const GROUP_SIZE = 15;

type Cache = Record<string, { tree: Prereq; model: string }>;

const INSTRUCTIONS = `You convert Stony Brook University course prerequisite text into JSON trees for a degree-planning tool. Precision matters more than completeness: never invent a course or condition the text doesn't state.

Node types:
- {"type":"course","code":"CSE 114"} with optional "minGrade" (letter grade, e.g. "C") and optional "concurrentAllowed": true when the text says the course may be taken concurrently.
- {"type":"standing","level":"U2"|"U3"|"U4"}: class standing. "U3 or U4 standing" → U3; "junior" → U3; "senior" → U4; "sophomore" → U2.
- {"type":"program","text":"..."}: a major, minor, or program admission requirement, verbatim (e.g. "CSE or ISE major", "admission to the Nursing program").
- {"type":"permission","text":"..."}: permission or approval of an instructor, department, or director, verbatim.
- {"type":"and","of":[...]}: all children required. {"type":"or","of":[...]}: any one child.
- {"type":"unparsed","text":"..."}: a condition you can't express with the types above, verbatim.

Rules:
- ";" and "and" join required conditions; "or" separates alternatives. Respect the grouping the punctuation implies; "X or Y; Z" is (X or Y) and Z.
- A number with no subject takes the most recent subject: "PHI 300, 304, or 306" → PHI 300, PHI 304, PHI 306.
- Slashes between subjects name one cross-listed course, so either code works: "ENS/PHY 119" → or[ENS 119, PHY 119]. Slashes between numbers name a lecture and its lab, both required: "PHY 131/133" → and[PHY 131, PHY 133]. Course codes are always "SUBJ 123", never "ENS/PHY 119".
- "C or higher in X and Y" puts minGrade "C" on X and Y. "X with a C or higher" puts it on X.
- Placement exam levels, test scores (SAT, ACT, AP, IB), auditions, portfolios, GPA minimums, "or equivalent", "transfer equivalent", and requirements for a course in a category ("one D.E.C. F or SBS course", "one HUM course", "any 300-level EGL course") → unparsed, with the verbatim words for that condition only.
- Keep the parts you can express: "AMS 151 or Math Placement level 6" → or[course AMS 151, unparsed "Math Placement level 6"].
- If the overall structure is unclear, return a single unparsed node with the whole text instead of guessing.

Input: a JSON array of {"id", "text"}. Output only a JSON object, no code fence or commentary: {"results":[{"id":"...","tree":{...}}]} with one entry per input id.

Example input: [{"id":"a","text":"C or higher in CSE 214 or CSE 260; CSE major; U3 or U4 standing"},{"id":"b","text":"MAT 125 or 131 or level 6 on the mathematics placement examination"}]
Example output: {"results":[{"id":"a","tree":{"type":"and","of":[{"type":"or","of":[{"type":"course","code":"CSE 214","minGrade":"C"},{"type":"course","code":"CSE 260","minGrade":"C"}]},{"type":"program","text":"CSE major"},{"type":"standing","level":"U3"}]}},{"id":"b","tree":{"type":"or","of":[{"type":"course","code":"MAT 125"},{"type":"course","code":"MAT 131"},{"type":"unparsed","text":"level 6 on the mathematics placement examination"}]}}]}`;

export interface ModelRunOptions {
  model: string;
  effort: "low" | "medium" | "high";
  budgetUsd: number;
  concurrency: number;
}

export interface ModelRunResult {
  trees: Map<string, Prereq>;
  /** Texts with no usable tree, with the last error. */
  failures: Map<string, string>;
  costUsd: number;
  fromCache: number;
  /** Texts not attempted because the budget ran out. */
  skipped: number;
}

/** Why a tree is unusable for its text, or undefined if it's fine. */
function problemWith(tree: unknown, text: string): string | undefined {
  const parsed = PrereqSchema.safeParse(tree);
  if (!parsed.success) return `invalid tree: ${parsed.error.issues[0]?.message}`;
  const allowed = new Set(codesIn(text));
  const invented = treeCodes(parsed.data).filter((c) => !allowed.has(c));
  return invented.length > 0 ? `names courses not in the text: ${invented.join(", ")}` : undefined;
}

export async function parseWithModel(texts: string[], options: ModelRunOptions): Promise<ModelRunResult> {
  const cache: Cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const result: ModelRunResult = { trees: new Map(), failures: new Map(), costUsd: 0, fromCache: 0, skipped: 0 };
  const todo: string[] = [];
  for (const text of new Set(texts)) {
    if (cache[text]) {
      result.trees.set(text, cache[text].tree);
      result.fromCache++;
    } else {
      todo.push(text);
    }
  }
  if (todo.length === 0) return result;

  const client = new Anthropic({ maxRetries: 4 });
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }];

  async function run(group: string[]) {
    const items = group.map((text, i) => ({ id: String(i), text }));
    const response = await client.messages.create({
      model: options.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: JSON.stringify(items) }],
      output_config: { effort: options.effort },
    });
    result.costUsd += costOf(options.model, response.usage);
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    let results: { id: string; tree: unknown }[] = [];
    try {
      results = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).results ?? [];
    } catch (error) {
      group.forEach((t) => result.failures.set(t, `response was not valid JSON: ${(error as Error).message}`));
      return;
    }
    for (const item of items) {
      const tree = results.find((r) => r.id === item.id)?.tree;
      const problem = tree === undefined ? "missing from the response" : problemWith(tree, item.text);
      if (problem) {
        result.failures.set(item.text, problem);
      } else {
        result.failures.delete(item.text);
        result.trees.set(item.text, tree as Prereq);
        cache[item.text] = { tree: tree as Prereq, model: options.model };
      }
    }
  }

  async function pool(groups: string[][]) {
    const queue = [...groups];
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        if (result.costUsd >= options.budgetUsd) {
          result.skipped += group.length;
          continue;
        }
        try {
          await run(group);
        } catch (error) {
          group.forEach((t) => result.failures.set(t, (error as Error).message));
        }
        process.stdout.write(".");
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, worker));
  }

  console.log(`Parsing ${todo.length} prerequisite texts with ${options.model} (${result.fromCache} cached)`);
  const groups: string[][] = [];
  for (let i = 0; i < todo.length; i += GROUP_SIZE) groups.push(todo.slice(i, i + GROUP_SIZE));
  await pool(groups);
  // One retry, one text per request, for anything that failed in a group.
  const retry = [...result.failures.keys()];
  if (retry.length > 0) await pool(retry.map((t) => [t]));
  process.stdout.write("\n");

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1) + "\n");
  return result;
}
