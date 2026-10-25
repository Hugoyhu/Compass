"use server";

import { z } from "zod";
import { schedulePlan } from "@/lib/engine/scheduler";
import { planContext } from "@/lib/services/plan";
import { semestersUsed } from "@/lib/engine/plan";
import { MAX_PLAN_TERMS, MAX_TARGET_TERMS, MIN_TARGET_TERMS, PlannedTermSchema } from "@/lib/student/record";
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

/** Fills the degree's empty semesters, keeping every semester already planned. */
export async function generatePlanAction(): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  if (record.programIds.length === 0) return { ok: false, error: "Add a program first" };
  const { plan } = schedulePlan(await planContext(record));
  return saveRecord({ ...record, plan });
}

/** Sets how many fall and spring semesters, counting from the first, the student aims to graduate in. */
export async function setTargetTerms(terms: number): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const min = Math.max(MIN_TARGET_TERMS, semestersUsed(record) + 1);
  if (!Number.isInteger(terms) || terms < min || terms > MAX_TARGET_TERMS) return { ok: false, error: `Choose ${min} to ${MAX_TARGET_TERMS} semesters` };
  return saveRecord({ ...record, targetTerms: terms });
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
