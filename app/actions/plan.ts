"use server";

import { z } from "zod";
import { generatePlan } from "@/lib/engine/plan";
import { planContext } from "@/lib/services/plan";
import { MAX_PLAN_TERMS, PlannedTermSchema } from "@/lib/student/record";
import { getStudentRecord } from "@/lib/student/store";
import { termOrdinal } from "@/lib/domain/terms";
import type { PlannedTerm } from "@/lib/domain/types";
import { saveRecord, type SaveResult } from "./record";

const PlanSchema = z.array(PlannedTermSchema).max(MAX_PLAN_TERMS);

/** Replaces the plan. Terms are kept in order and must come after the current term. */
export async function savePlan(input: unknown): Promise<SaveResult> {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That plan couldn't be saved" };
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const plan = (parsed.data as PlannedTerm[])
    .filter((t) => termOrdinal(t.term) > termOrdinal(record.currentTerm))
    .sort((a, b) => termOrdinal(a.term) - termOrdinal(b.term));
  return saveRecord({ ...record, plan });
}

/** Fills the empty semesters of a four-year plan, keeping the terms already planned. */
export async function generatePlanAction(): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const plan = generatePlan(await planContext(record));
  return saveRecord({ ...record, plan });
}

/** Sets the fewest credits the student wants in a fall or spring term. */
export async function setMinTermCredits(credits: number): Promise<SaveResult> {
  if (!Number.isInteger(credits) || credits < 0 || credits > 19) return { ok: false, error: "Choose 0 to 19 credits" };
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  return saveRecord({ ...record, minTermCredits: credits });
}

/** Adds a course to a term of the plan, adding the term if the plan doesn't have it. */
export async function addCourseToPlan(code: string, term: string): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const existing = record.plan.find((t) => t.term === term);
  if (existing?.items.some((i) => "code" in i && i.code === code)) return { ok: true };
  const plan = existing
    ? record.plan.map((t) => (t === existing ? { ...t, items: [...t.items, { code }] } : t))
    : [...record.plan, { term, items: [{ code }] }];
  return savePlan(plan);
}
