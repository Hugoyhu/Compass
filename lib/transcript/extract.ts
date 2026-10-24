/**
 * Transcript PDF → draft course attempts.
 *
 * Claude reads the PDF and transcribes rows verbatim into a small, flat schema
 * (structured outputs). Interpretation (code normalization, grade and term
 * mapping, in-progress detection) happens in `normalizeTranscript`, in plain
 * code, so it is deterministic and testable.
 *
 * Privacy: only course rows, the student's name, and their plan are
 * extracted. ID numbers and dates of birth are never requested or returned.
 * Nothing here logs or stores the PDF.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SbcCodeSchema } from "@/lib/domain/catalog/common";
import { termOrdinal } from "@/lib/domain/terms";
import type { CourseAttempt, Grade, SbcCode, TermId } from "@/lib/domain/types";

export const TRANSCRIPT_MODEL = "claude-haiku-5-5";

// Every field is required (nullable where absent): structured outputs limit optional properties.
const ExtractedRowSchema = z.strictObject({
  section: z.enum(["sbu", "transfer", "test"]).describe('"test" = AP/IB/exam credit; "transfer" = credit from another institution'),
  rawCode: z.string().describe('Course code exactly as printed, e.g. "CHE 131/AP" or "CSE 114AP/A"'),
  title: z.string().describe("Description column as printed"),
  term: z.string().nullable().describe('For Stony Brook courses, the term heading, e.g. "Fall 2026". Null for test and transfer credit'),
  attemptedCredits: z.number(),
  grade: z.string().nullable().describe('Grade as printed ("A-", "T", "P", "W"); null when the grade column is blank'),
  origin: z.string().nullable().describe("For transfer credit, the institution; for test credit, the exam name if printed"),
  attributes: z.array(z.string()).describe('Codes from "Course Attributes" lines, e.g. ["STEM+"] or ["CER"]. Empty if none'),
});

const ExtractionSchema = z.strictObject({
  isTranscript: z.boolean().describe("False if the document is not an academic transcript"),
  studentName: z.string().nullable(),
  plan: z.string().nullable().describe('Major/plan as printed, e.g. "Computer Science Major"'),
  rows: z.array(ExtractedRowSchema),
});

export type TranscriptExtraction = z.infer<typeof ExtractionSchema>;

// The schema is flat, every field required, with no numeric or length constraints, so
// only the $schema marker needs removing for structured outputs.
const OUTPUT_SCHEMA = z.toJSONSchema(ExtractionSchema) as Record<string, unknown>;
delete OUTPUT_SCHEMA.$schema;

const INSTRUCTIONS = `Transcribe every course row from this Stony Brook University transcript into the JSON schema. Copy values exactly as printed; do not interpret, correct, or skip rows.

- Include rows from Transfer Credits, Test Credits, and every term of the undergraduate record.
- For Stony Brook courses, set term to the term heading the row appears under (e.g. "Fall 2026").
- Attributes are the codes at the start of each "Course Attributes" line under a course (e.g. "STEM+ Science, Technology..." → "STEM+"). Ignore "Req Designation" lines.
- Do not include totals, GPA lines, or headers as rows.
- Never output student ID numbers, dates of birth, or addresses.`;

export async function extractTranscript(client: Anthropic, pdfBase64: string): Promise<{
  extraction: TranscriptExtraction;
  costUsd: number;
}> {
  const response = await client.messages.create({
    model: TRANSCRIPT_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: INSTRUCTIONS },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to read this document.");
  if (response.stop_reason === "max_tokens") throw new Error("The transcript was too long to read in one pass.");

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const extraction = ExtractionSchema.parse(JSON.parse(text));
  // Haiku 5.5 pricing: $0.10 / $0.50 per million input / output tokens.
  const costUsd = (response.usage.input_tokens * 0.1 + response.usage.output_tokens * 0.5) / 1_000_000;
  return { extraction, costUsd };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const LETTER_GRADES = new Set(["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"]);
const GRADE_ALIASES: Record<string, Grade> = { T: "T", P: "P", S: "P", NC: "NC", NR: "NC", U: "NC", W: "W", I: "I" };
const SEASONS: Record<string, string> = { fall: "FA", winter: "WI", spring: "SP", summer: "SU" };
const SBC_CODES = new Set<string>(SbcCodeSchema.options);

export function normalizeCode(raw: string): string | null {
  const match = raw.toUpperCase().match(/^\s*([A-Z]{3,4})\s*(\d{3})/);
  return match ? `${match[1]} ${match[2]}` : null;
}

export function normalizeTerm(raw: string | null): TermId | undefined {
  const match = raw?.match(/(fall|winter|spring|summer)\s+(\d{4})/i);
  return match ? (`${match[2]}-${SEASONS[match[1].toLowerCase()]}` as TermId) : undefined;
}

function normalizeGrade(raw: string | null): Grade | null {
  if (!raw) return null;
  const grade = raw.trim().toUpperCase();
  if (LETTER_GRADES.has(grade)) return grade as Grade;
  return GRADE_ALIASES[grade] ?? null;
}

export interface TranscriptDraft {
  studentName: string | null;
  plan: string | null;
  /** Latest term with in-progress courses, if any. */
  currentTerm: TermId | null;
  attempts: CourseAttempt[];
  /** Rows that need the student's attention before saving. */
  warnings: string[];
}

export function normalizeTranscript(extraction: TranscriptExtraction): TranscriptDraft {
  const attempts: CourseAttempt[] = [];
  const warnings: string[] = [];

  for (const row of extraction.rows) {
    const code = normalizeCode(row.rawCode);
    if (!code) {
      warnings.push(`Skipped "${row.rawCode} ${row.title}": unrecognized course code`);
      continue;
    }
    const grade = normalizeGrade(row.grade);
    if (row.grade && !grade) warnings.push(`${code}: grade "${row.grade}" isn't recognized; please set it`);

    const source = row.section === "test" ? "ap" : row.section === "transfer" ? "transfer" : "sbu";
    const term = source === "sbu" ? normalizeTerm(row.term) : undefined;
    // A Stony Brook course with no grade yet is in progress; exam/transfer credit is always earned.
    const status = source === "sbu" && !row.grade ? "in-progress" : "completed";
    const sbc = row.attributes.map((a) => a.trim().toUpperCase()).filter((a): a is SbcCode => SBC_CODES.has(a));

    attempts.push({
      code,
      source,
      ...(term && { term }),
      ...(grade ? { grade } : source !== "sbu" ? { grade: "T" as const } : {}),
      status,
      credits: row.attemptedCredits,
      ...(row.origin && { origin: row.origin.slice(0, 80) }),
      title: row.title.slice(0, 80),
      ...(sbc.length > 0 && { sbc }),
    });
  }

  const inProgressTerms = attempts.filter((a) => a.status === "in-progress" && a.term).map((a) => a.term!);
  return {
    studentName: extraction.studentName,
    plan: extraction.plan,
    currentTerm: inProgressTerms.sort((a, b) => termOrdinal(a) - termOrdinal(b)).at(-1) ?? null,
    attempts,
    warnings,
  };
}
