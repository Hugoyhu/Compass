"use server";

import { TermIdSchema } from "@/lib/student/record";
import { ClassNumbersSchema, writeSchedule } from "@/lib/student/schedule";
import type { SaveResult } from "./record";

/** Saves the sections picked for a term, to the cookie and (signed in) the account. */
export async function saveSchedule(term: unknown, classNumbers: unknown): Promise<SaveResult> {
  const parsedTerm = TermIdSchema.safeParse(term);
  const parsedNumbers = ClassNumbersSchema.safeParse(classNumbers);
  if (!parsedTerm.success || !parsedNumbers.success) return { ok: false, error: "That schedule couldn't be saved" };
  try {
    await writeSchedule(parsedTerm.data, parsedNumbers.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
