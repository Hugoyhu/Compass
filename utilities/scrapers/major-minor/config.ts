import { existsSync } from "node:fs";
import path from "node:path";

/** All paths are relative to the repo root; run the scripts via npm from there. */
export const SCRAPER_DIR = path.resolve("utilities/scrapers/major-minor");
export const RAW_DIR = path.resolve("data/raw/programs");
export const RAW_INDEX = path.join(RAW_DIR, "index.json");
export const PROGRAMS_DIR = path.resolve("data/catalog/programs");
export const FAILED_DIR = path.resolve("data/catalog/failed");
export const GOLD_FILE = path.join(PROGRAMS_DIR, "cse-bs.json");
/** Per-program log of the most recent extract run, read by run.ts for its report. */
export const RUN_LOG = path.join(SCRAPER_DIR, "last-run.json");

export const CATALOG = {
  name: "Fall 2026 Undergraduate Catalog",
  origin: "https://catalog.stonybrook.edu",
  catoid: 11,
  /** Navigation pages that list programs, by kind. */
  listings: [
    { kind: "major", navoid: 1134 },
    { kind: "minor", navoid: 1136 },
  ],
  /** Poid of the hand-encoded Computer Science BS. */
  goldPoid: 1411,
} as const;

/** Delay between page loads. Keep this polite. */
export const REQUEST_DELAY_MS = 1500;

export const DEFAULT_MODEL = "claude-haiku-5-5";

/** USD per million tokens, from the Claude API pricing table (prompts under 100K tokens). */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Loads ANTHROPIC_API_KEY from utilities/scrapers/major-minor/.env, then the repo root .env, if present. */
export function loadEnv() {
  for (const file of [path.join(SCRAPER_DIR, ".env"), path.resolve(".env")]) {
    if (!process.env.ANTHROPIC_API_KEY && existsSync(file)) process.loadEnvFile(file);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY in .env at the repo root or in utilities/scrapers/major-minor/.env (see README.md)");
  }
}

export interface RawProgramEntry {
  poid: number;
  name: string;
  kind: "major" | "minor";
  url: string;
  file: string;
  fetchedAt: string;
}

export interface RunLogEntry {
  id: string;
  name: string;
  kind: "major" | "minor";
  ok: boolean;
  attempts: number;
  costUsd: number;
  error?: string;
}

export interface RunLog {
  model: string;
  startedAt: string;
  budgetUsd: number;
  spentUsd: number;
  /** Programs left unextracted because the budget ran out. */
  skipped: number;
  programs: RunLogEntry[];
}
