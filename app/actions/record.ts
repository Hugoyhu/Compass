"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { CourseCodeSchema } from "@/lib/domain/catalog/common";
import { getCurrentUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data/repository";
import { MAX_PROGRAMS, type StudentRecord } from "@/lib/domain/types";
import { clearAccountRecord, saveAccountRecord } from "@/lib/student/account-records";
import { clearGuestRecord, writeGuestRecord } from "@/lib/student/guest-records";
import { StudentRecordSchema } from "@/lib/student/record";
import { getStudentRecord } from "@/lib/student/store";
import { DEFAULT_CURRENT_TERM } from "@/components/record/options";

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Stores the record in the signed-in account, or in cookies for guests. The
 * session is re-checked here; nothing from the client decides whose record it is.
 * Account writes don't touch cookies, so refresh() re-renders the page.
 */
async function store(record: StudentRecord) {
  const user = await getCurrentUser();
  if (user) {
    await saveAccountRecord(user.id, { ...record, id: user.id });
    refresh();
  } else {
    await writeGuestRecord(record);
  }
}

export async function saveRecord(input: unknown): Promise<SaveResult> {
  const parsed = StudentRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  try {
    await store(parsed.data as StudentRecord);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Adds a program to the visitor's record, starting a record if they have none. */
export async function addProgram(programId: string): Promise<SaveResult> {
  const programs = await getRepository().listPrograms();
  if (!programs.some((p) => p.id === programId)) return { ok: false, error: "Unknown program" };
  const record = (await getStudentRecord()) ?? {
    id: "browser",
    name: "",
    entryTerm: DEFAULT_CURRENT_TERM,
    currentTerm: DEFAULT_CURRENT_TERM,
    programIds: [],
    attempts: [],
    plan: [],
  };
  if (record.programIds.includes(programId)) return { ok: true };
  if (record.programIds.length >= MAX_PROGRAMS) return { ok: false, error: `You can add up to ${MAX_PROGRAMS} programs` };
  return saveRecord({ ...record, programIds: [...record.programIds, programId] });
}

export async function removeProgram(programId: string): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record?.programIds.includes(programId)) return { ok: true };
  return saveRecord({ ...record, programIds: record.programIds.filter((id) => id !== programId) });
}

export async function clearRecord(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await clearAccountRecord(user.id);
    refresh();
  } else {
    await clearGuestRecord();
  }
}

/** Declares a concentration, specialization, or track; null clears the choice. */
export async function setChoice(choiceId: string, alternativeId: string | null): Promise<SaveResult> {
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const choices = { ...record.choices };
  if (alternativeId) choices[choiceId] = alternativeId;
  else delete choices[choiceId];
  return saveRecord({ ...record, choices });
}

const PREFER_PREFIX = "prefer:";

/**
 * Switches which alternative the student means to take ("AMS 151 + 161" or "MAT 125 + 126 + 127"): the chosen
 * courses become preferred, the others' no longer are, and any of the others' courses already in the plan come
 * out of it, since the plan would otherwise keep the old path.
 */
export async function chooseAlternative(chosen: string[], others: string[]): Promise<SaveResult> {
  const codes = z.array(CourseCodeSchema).max(12);
  const parsed = z.object({ chosen: codes, others: codes }).safeParse({ chosen, others });
  if (!parsed.success) return { ok: false, error: "That choice couldn't be saved" };
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const keep = new Set(parsed.data.chosen);
  const drop = new Set(parsed.data.others.filter((c) => !keep.has(c)));
  const choices = Object.fromEntries(Object.entries(record.choices ?? {}).filter(([k]) => !drop.has(k.replace(PREFER_PREFIX, "")) || !k.startsWith(PREFER_PREFIX)));
  for (const code of keep) choices[PREFER_PREFIX + code] = code;
  const plan = record.plan.map((t) => ({ ...t, items: t.items.filter((i) => !("code" in i) || !drop.has(i.code)) }));
  return saveRecord({ ...record, choices, plan });
}

/** Takes one course off the student's list for a requirement and puts another in its place (and out of the plan). */
export async function swapCourse(from: string, to: string): Promise<SaveResult> {
  const parsed = z.object({ from: CourseCodeSchema, to: CourseCodeSchema }).safeParse({ from, to });
  if (!parsed.success || from === to) return { ok: false, error: "That choice couldn't be saved" };
  const record = await getStudentRecord();
  if (!record) return { ok: false, error: "Add your courses first" };
  const choices = { ...record.choices };
  delete choices[`pick:${from}`];
  delete choices[`avoid:${to}`];
  choices[`avoid:${from}`] = from;
  choices[`pick:${to}`] = to;
  const plan = record.plan.map((t) => ({ ...t, items: t.items.filter((i) => !("code" in i) || i.code !== from) }));
  return saveRecord({ ...record, choices, plan });
}
