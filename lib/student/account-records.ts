/** Student records for signed-in accounts, stored in Postgres. */
import { requireSql } from "@/lib/db/client";
import type { CourseAttempt, StudentRecord, TermId } from "@/lib/domain/types";
import { StudentRecordSchema } from "./record";

export async function loadAccountRecord(userId: string): Promise<StudentRecord | null> {
  const sql = requireSql();
  const [profile] = await sql`
    select name, entry_term, current_term, program_ids from student_profiles where user_id = ${userId}`;
  if (!profile) return null;
  const rows = await sql`
    select code, source, term, grade, status, credits, origin, title, sbc
    from course_attempts where user_id = ${userId} order by position`;
  const attempts: CourseAttempt[] = rows.map((r) => ({
    code: r.code,
    source: r.source,
    ...(r.term && { term: r.term as TermId }),
    ...(r.grade && { grade: r.grade }),
    status: r.status,
    ...(r.credits !== null && { credits: Number(r.credits) }),
    ...(r.origin && { origin: r.origin }),
    ...(r.title && { title: r.title }),
    ...(r.sbc?.length && { sbc: r.sbc }),
  }));
  const parsed = StudentRecordSchema.safeParse({
    id: userId,
    name: profile.name,
    entryTerm: profile.entry_term,
    currentTerm: profile.current_term,
    programIds: profile.program_ids,
    attempts,
  });
  return parsed.success ? (parsed.data as StudentRecord) : null;
}

/** Replaces the account's record. The caller must have verified the session. */
export async function saveAccountRecord(userId: string, record: StudentRecord): Promise<void> {
  await requireSql().begin(async (tx) => {
    await tx`
      insert into student_profiles (user_id, name, entry_term, current_term, program_ids, updated_at)
      values (${userId}, ${record.name}, ${record.entryTerm}, ${record.currentTerm}, ${tx.array(record.programIds)}, now())
      on conflict (user_id) do update set
        name = excluded.name, entry_term = excluded.entry_term, current_term = excluded.current_term,
        program_ids = excluded.program_ids, updated_at = now()`;
    await tx`delete from course_attempts where user_id = ${userId}`;
    if (record.attempts.length === 0) return;
    const rows = record.attempts.map((a, position) => ({
      user_id: userId,
      position,
      code: a.code,
      source: a.source,
      term: a.term ?? null,
      grade: a.grade ?? null,
      status: a.status,
      credits: a.credits ?? null,
      origin: a.origin ?? null,
      title: a.title ?? null,
      sbc: a.sbc?.length ? tx.array(a.sbc) : null,
    }));
    await tx`insert into course_attempts ${tx(rows, "user_id", "position", "code", "source", "term", "grade", "status", "credits", "origin", "title", "sbc")}`;
  });
}

export async function clearAccountRecord(userId: string): Promise<void> {
  // Attempts go with the profile row in the same transaction.
  await requireSql().begin(async (tx) => {
    await tx`delete from course_attempts where user_id = ${userId}`;
    await tx`delete from student_profiles where user_id = ${userId}`;
  });
}
