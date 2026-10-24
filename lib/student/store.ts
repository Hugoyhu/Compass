/**
 * The current visitor's student record: from their account when signed in,
 * otherwise from their browser cookies. Request-time API: call inside <Suspense>.
 */
import { getCurrentUser } from "@/lib/auth/session";
import type { StudentRecord } from "@/lib/domain/types";
import { loadAccountRecord } from "./account-records";
import { readGuestRecord } from "./guest-records";

export async function getStudentRecord(): Promise<StudentRecord | null> {
  const user = await getCurrentUser();
  return user ? loadAccountRecord(user.id) : readGuestRecord();
}
