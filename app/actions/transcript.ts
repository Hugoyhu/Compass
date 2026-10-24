"use server";

import Anthropic from "@anthropic-ai/sdk";
import { headers } from "next/headers";
import { extractTranscript, normalizeTranscript, type TranscriptDraft } from "@/lib/transcript/extract";

const MAX_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT = { requests: 8, windowMs: 60 * 60 * 1000 };

// Best-effort, per server instance. A public demo spends real API credits, so
// pair this with a spend limit on the API key in the Anthropic Console.
const recentRequests = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (recentRequests.get(key) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.requests) return true;
  recentRequests.set(key, [...recent, now]);
  return false;
}

export type ExtractResult = { ok: true; draft: TranscriptDraft } | { ok: false; error: string };

/**
 * Reads an uploaded transcript PDF and returns draft course attempts for the
 * student to review. Nothing is saved here, and the PDF is not stored.
 */
export async function extractTranscriptAction(formData: FormData): Promise<ExtractResult> {
  const file = formData.get("transcript");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PDF file to upload." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That file is larger than 4 MB." };

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, error: "That file isn't a PDF." };

  const requestHeaders = await headers();
  const visitor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(visitor)) return { ok: false, error: "Too many uploads. Please try again in an hour." };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "Transcript reading isn't configured on this server (missing ANTHROPIC_API_KEY)." };
  }

  try {
    const { extraction } = await extractTranscript(new Anthropic({ maxRetries: 2 }), bytes.toString("base64"));
    if (!extraction.isTranscript) return { ok: false, error: "That doesn't look like an academic transcript." };
    const draft = normalizeTranscript(extraction);
    if (draft.attempts.length === 0) return { ok: false, error: "No courses were found in that transcript." };
    return { ok: true, draft };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The transcript reader is unavailable right now (${error.status ?? "network error"}).` };
    }
    return { ok: false, error: "The transcript couldn't be read. Try again, or add courses manually." };
  }
}
