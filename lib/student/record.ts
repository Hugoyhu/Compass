/**
 * Student record validation and the compact cookie encoding.
 *
 * The record lives only in the student's browser, as cookies, so a deployed
 * demo needs no database or accounts. Cookies are sent with each request,
 * which lets server components run the audit with the student's data.
 * The encoding is compact JSON arrays, base64url, split across cookies when
 * it outgrows one (~4 KB per cookie).
 */
import { z } from "zod";
import { CourseCodeSchema, LetterGradeSchema, SbcCodeSchema } from "@/lib/domain/catalog/common";
import { MAX_PROGRAMS, type CourseAttempt, type CreditSource, type PlannedTerm, type StudentRecord, type TermId } from "@/lib/domain/types";

export const TermIdSchema = z.string().regex(/^\d{4}-(FA|WI|SP|SU)$/) as unknown as z.ZodType<TermId>;
export const GradeSchema = z.union([LetterGradeSchema, z.enum(["P", "T", "NC", "W", "I"])]);

export const CourseAttemptSchema = z.object({
  code: CourseCodeSchema,
  source: z.enum(["sbu", "transfer", "ap"]),
  term: TermIdSchema.optional(),
  grade: GradeSchema.optional(),
  status: z.enum(["completed", "in-progress"]),
  credits: z.number().min(0).max(12).optional(),
  origin: z.string().max(80).optional(),
  title: z.string().max(80).optional(),
  sbc: z.array(SbcCodeSchema).optional(),
});

/** Enough for a full four-year plan plus summer and winter sessions. */
export const MAX_PLAN_TERMS = 16;

export const PlanItemSchema = z.union([
  z.strictObject({ code: CourseCodeSchema }),
  z.strictObject({ elective: z.number().min(0).max(12) }),
]);

export const PlannedTermSchema = z.object({
  term: TermIdSchema,
  items: z.array(PlanItemSchema).max(10),
});

export const StudentRecordSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  entryTerm: TermIdSchema,
  currentTerm: TermIdSchema,
  // Majors, minors, and special programs (Honors College, WISE, ...).
  programIds: z.array(z.string()).max(MAX_PROGRAMS),
  attempts: z.array(CourseAttemptSchema).max(120),
  plan: z.array(PlannedTermSchema).max(MAX_PLAN_TERMS).default([]),
  minTermCredits: z.number().int().min(0).max(19).optional(),
});

export const RECORD_COOKIE = "compass_record";
export const MAX_COOKIE_CHUNKS = 6;
const CHUNK_SIZE = 3800;
const VERSION = 1;

const SOURCE_CODES: Record<CreditSource, string> = { sbu: "s", transfer: "t", ap: "a" };
const SOURCES = Object.fromEntries(Object.entries(SOURCE_CODES).map(([k, v]) => [v, k])) as Record<string, CreditSource>;

type PackedAttempt = [string, string, string, string, 0 | 1, number | null, string, string, string];

function pack(a: CourseAttempt): PackedAttempt {
  return [
    a.code,
    SOURCE_CODES[a.source],
    a.term ?? "",
    a.grade ?? "",
    a.status === "in-progress" ? 1 : 0,
    a.credits ?? null,
    (a.sbc ?? []).join(","),
    a.title ?? "",
    a.origin ?? "",
  ];
}

function unpack(p: PackedAttempt): CourseAttempt {
  const [code, source, term, grade, inProgress, credits, sbc, title, origin] = p;
  return {
    code,
    source: SOURCES[source],
    ...(term && { term: term as TermId }),
    ...(grade && { grade: grade as CourseAttempt["grade"] }),
    status: inProgress ? "in-progress" : "completed",
    ...(credits !== null && { credits }),
    ...(sbc && { sbc: sbc.split(",") as CourseAttempt["sbc"] }),
    ...(title && { title }),
    ...(origin && { origin }),
  };
}

/** A plan term as [term, items], where an item is a course code or an elective's credits. */
type PackedTerm = [string, (string | number)[]];

function packTerm(t: PlannedTerm): PackedTerm {
  return [t.term, t.items.map((i) => ("code" in i ? i.code : i.elective))];
}

function unpackTerm([term, items]: PackedTerm): PlannedTerm {
  return { term: term as TermId, items: items.map((i) => (typeof i === "number" ? { elective: i } : { code: i })) };
}

/** Encodes a record into cookie-sized chunks. Throws if it won't fit. */
export function encodeRecord(record: StudentRecord): string[] {
  const payload = [
    VERSION,
    record.name,
    record.entryTerm,
    record.currentTerm,
    record.programIds,
    record.attempts.map(pack),
    record.plan.map(packTerm),
    record.minTermCredits ?? null,
  ];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  if (chunks.length > MAX_COOKIE_CHUNKS) throw new Error("Record is too large to store in the browser");
  return chunks;
}

/** Decodes and validates; returns null for anything malformed. */
export function decodeRecord(chunks: string[]): StudentRecord | null {
  if (chunks.length === 0) return null;
  try {
    // Records saved before plans existed have no seventh or eighth element.
    const [version, name, entryTerm, currentTerm, programIds, attempts, plan = [], minTermCredits = null] = JSON.parse(
      Buffer.from(chunks.join(""), "base64url").toString("utf8"),
    );
    if (version !== VERSION) return null;
    const parsed = StudentRecordSchema.safeParse({
      id: "browser",
      name,
      entryTerm,
      currentTerm,
      programIds,
      attempts: (attempts as PackedAttempt[]).map(unpack),
      plan: (plan as PackedTerm[]).map(unpackTerm),
      ...(minTermCredits !== null && { minTermCredits }),
    });
    return parsed.success ? (parsed.data as StudentRecord) : null;
  } catch {
    return null;
  }
}
