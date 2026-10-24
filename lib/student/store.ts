import { cookies } from "next/headers";
import type { StudentRecord } from "@/lib/domain/types";
import { MAX_COOKIE_CHUNKS, RECORD_COOKIE, decodeRecord } from "./record";

/**
 * The current visitor's record, read from their cookies; null if they haven't
 * created one. Request-time API: call it inside a <Suspense> boundary.
 */
export async function getStudentRecord(): Promise<StudentRecord | null> {
  const store = await cookies();
  const chunks: string[] = [];
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    const value = store.get(`${RECORD_COOKIE}.${i}`)?.value;
    if (!value) break;
    chunks.push(value);
  }
  return decodeRecord(chunks);
}
