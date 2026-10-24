/** Student records for signed-out visitors, stored in their browser cookies. */
import { cookies } from "next/headers";
import type { StudentRecord } from "@/lib/domain/types";
import { MAX_COOKIE_CHUNKS, RECORD_COOKIE, decodeRecord, encodeRecord } from "./record";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function readGuestRecord(): Promise<StudentRecord | null> {
  const store = await cookies();
  const chunks: string[] = [];
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    const value = store.get(`${RECORD_COOKIE}.${i}`)?.value;
    if (!value) break;
    chunks.push(value);
  }
  return decodeRecord(chunks);
}

/** Only callable from Server Actions. Throws if the record is too large for cookies. */
export async function writeGuestRecord(record: StudentRecord): Promise<void> {
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

/** Only callable from Server Actions. */
export async function clearGuestRecord(): Promise<void> {
  const store = await cookies();
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    if (store.has(`${RECORD_COOKIE}.${i}`)) store.delete(`${RECORD_COOKIE}.${i}`);
  }
}
