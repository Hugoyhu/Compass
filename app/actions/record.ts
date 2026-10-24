"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getRepository } from "@/lib/data/repository";
import type { StudentRecord } from "@/lib/domain/types";
import { MAX_COOKIE_CHUNKS, RECORD_COOKIE, StudentRecordSchema, encodeRecord } from "@/lib/student/record";

const ONE_YEAR = 60 * 60 * 24 * 365;

async function writeRecord(record: StudentRecord) {
  const chunks = encodeRecord(record);
  const store = await cookies();
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    const name = `${RECORD_COOKIE}.${i}`;
    if (i < chunks.length) {
      store.set(name, chunks[i], { maxAge: ONE_YEAR, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    } else if (store.has(name)) {
      store.delete(name);
    }
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Validates and stores the record in the visitor's cookies. Setting cookies re-renders the page. */
export async function saveRecord(input: unknown): Promise<SaveResult> {
  const parsed = StudentRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  try {
    await writeRecord(parsed.data as StudentRecord);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Replaces the visitor's record with the fictional sample student. */
export async function loadSampleRecord(): Promise<void> {
  await writeRecord(await getRepository().getSampleStudent());
}

export async function clearRecord(): Promise<void> {
  const store = await cookies();
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) store.delete(`${RECORD_COOKIE}.${i}`);
}
