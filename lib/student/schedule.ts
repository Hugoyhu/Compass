/**
 * The class sections a visitor picked in the Schedule Builder, per term.
 *
 * Always kept in a cookie, so it works without an account. When signed in, every
 * save is also copied to Postgres, and the account's copy wins on read so the
 * schedule follows the account to other browsers.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql, requireSql } from "@/lib/db/client";

export const SCHEDULE_COOKIE = "compass_schedule";
export const MAX_SCHEDULE_SECTIONS = 30;
const ONE_YEAR = 60 * 60 * 24 * 365;

export const ClassNumbersSchema = z.array(z.string().regex(/^\d{1,8}$/)).max(MAX_SCHEDULE_SECTIONS);
const CookieSchema = z.record(z.string(), ClassNumbersSchema);

async function readCookie(): Promise<Record<string, string[]>> {
  const raw = (await cookies()).get(SCHEDULE_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = CookieSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Class numbers picked for a term. Request-time API: call inside <Suspense>. */
export async function readSchedule(term: string): Promise<string[]> {
  const user = await getCurrentUser();
  if (user) {
    const [row] = await requireSql()`
      select class_numbers from schedule_sections where user_id = ${user.id} and term = ${term}`;
    if (row) return row.class_numbers as string[];
  }
  return (await readCookie())[term] ?? [];
}

/** Only callable from Server Actions. Writes the cookie, and the account's copy when signed in. */
export async function writeSchedule(term: string, classNumbers: string[]): Promise<void> {
  const store = await cookies();
  const current = await readCookie();
  store.set(SCHEDULE_COOKIE, JSON.stringify({ ...current, [term]: classNumbers }), {
    maxAge: ONE_YEAR,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  const user = getSql() ? await getCurrentUser() : null;
  if (!user) return;
  await requireSql()`
    insert into schedule_sections (user_id, term, class_numbers, updated_at)
    values (${user.id}, ${term}, ${classNumbers}, now())
    on conflict (user_id, term) do update set class_numbers = excluded.class_numbers, updated_at = now()`;
}
