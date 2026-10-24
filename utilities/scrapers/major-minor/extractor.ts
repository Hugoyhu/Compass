/**
 * One program page → validated ExtractedProgram.
 *
 * Structured outputs can't be used: the API rejects even a depth-1 rule tree
 * with "compiled grammar is too large". Instead the JSON Schema goes in the
 * cached system prompt and the response is checked with the full Zod schema.
 *
 * Flow: request → parse → Zod validation → cross-reference checks. If any
 * check fails, the model gets one retry with the errors appended to the
 * conversation.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ProgramExtractionSchema, type ExtractedProgram, type ProgramDefinition } from "@/lib/domain/catalog/program";
import { checkProgramReferences } from "@/lib/domain/catalog/validate";
import { PRICING } from "./config";
import { INSTRUCTIONS, schemaBlock, userMessage, workedExample } from "./prompt";

export interface ExtractOptions {
  model: string;
  effort: "low" | "medium" | "high";
  /** Worked example placed in the cached system prefix. Omit for zero-shot evaluation. */
  example?: { pageText: string; json: unknown };
}

export interface ExtractResult {
  program?: ExtractedProgram;
  errors: string[];
  attempts: number;
  costUsd: number;
}

const validator = ProgramExtractionSchema;
const outputSchema = JSON.stringify(z.toJSONSchema(validator));

export function costOf(model: string, usage: Anthropic.Usage): number {
  const price = PRICING[model];
  if (!price) return 0;
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * price.input + usage.output_tokens * price.output) / 1_000_000;
}

function check(json: unknown): { program?: ExtractedProgram; errors: string[] } {
  const parsed = validator.safeParse(json);
  if (!parsed.success) return { errors: [z.prettifyError(parsed.error)] };
  // Reference checks expect a full definition; source/review don't affect them.
  // Without a course list, the only warnings are id-prefix slips, which the model can fix too.
  const issues = checkProgramReferences(parsed.data as ProgramDefinition);
  return { program: parsed.data, errors: issues.map((i) => `${i.path}: ${i.message}`) };
}

export async function extractProgram(
  client: Anthropic,
  program: { id: string; name: string; kind: string },
  pageText: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: `${INSTRUCTIONS}\n\n${schemaBlock(outputSchema)}` }];
  if (options.example) system.push({ type: "text", text: workedExample(options.example.pageText, options.example.json) });
  // Cache the stable prefix (instructions + example); only the page varies per call.
  system[system.length - 1].cache_control = { type: "ephemeral" };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage(program, pageText) }];
  let costUsd = 0;
  let errors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.messages
      .stream({
        model: options.model,
        max_tokens: 64000,
        system,
        messages,
        output_config: { effort: options.effort },
      })
      .finalMessage();
    costUsd += costOf(options.model, response.usage);

    if (response.stop_reason === "refusal") return { errors: ["Model refused the request"], attempts: attempt, costUsd };
    if (response.stop_reason === "max_tokens") return { errors: ["Output truncated at max_tokens"], attempts: attempt, costUsd };

    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    let json: unknown;
    try {
      // Tolerate a code fence or a sentence around the object.
      json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch (error) {
      errors = [`Response was not valid JSON (${(error as Error).message}). Response text:\n${text}`];
    }
    if (json !== undefined) {
      const result = check(json);
      if (result.errors.length === 0) return { program: result.program, errors: [], attempts: attempt, costUsd };
      errors = result.errors;
    }

    // Retry once with the errors. Pass the full assistant content back, thinking blocks included.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `The JSON failed validation:\n${errors.join("\n")}\n\nReturn the complete corrected JSON.`,
    });
  }
  return { errors, attempts: 2, costUsd };
}
