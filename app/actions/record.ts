"use server";

import { refresh } from "next/cache";
import { z } from "zod";
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

/** Replaces the visitor's record with the fictional sample student. */
export async function loadSampleRecord(): Promise<void> {
  await store(await getRepository().getSampleStudent());
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
