"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data/repository";
import type { StudentRecord } from "@/lib/domain/types";
import { clearAccountRecord, saveAccountRecord } from "@/lib/student/account-records";
import { clearGuestRecord, writeGuestRecord } from "@/lib/student/guest-records";
import { StudentRecordSchema } from "@/lib/student/record";

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
