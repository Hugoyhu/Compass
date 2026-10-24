/**
 * The class sections a visitor picked in the Schedule Builder, per term.
 *
 * Like the student record: a signed-in account's schedule lives only in
 * Postgres, and a guest's only in a cookie. The two never mix, so one person's
 * schedule can't show up for the next person on the same browser. Signing in
 * moves the guest's cookie schedule into the account (see adoptGuestSchedule).
 */
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { requireSql } from "@/lib/db/client";

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
  if (!user) return (await readCookie())[term] ?? [];
  const [row] = await requireSql()`
    select class_numbers from schedule_sections where user_id = ${user.id} and term = ${term}`;
  return (row?.class_numbers as string[] | undefined) ?? [];
}

/** Only callable from Server Actions. Saves to the account when signed in, otherwise to the cookie. */
export async function writeSchedule(term: string, classNumbers: string[]): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await saveAccountSchedule(user.id, term, classNumbers);
    return;
  }
  (await cookies()).set(SCHEDULE_COOKIE, JSON.stringify({ ...(await readCookie()), [term]: classNumbers }), {
    maxAge: ONE_YEAR,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function saveAccountSchedule(userId: string, term: string, classNumbers: string[]): Promise<void> {
  await requireSql()`
    insert into schedule_sections (user_id, term, class_numbers, updated_at)
    values (${userId}, ${term}, ${classNumbers}, now())
    on conflict (user_id, term) do update set class_numbers = excluded.class_numbers, updated_at = now()`;
}

/**
 * Moves a signed-out visitor's cookie schedule into an account at sign-in or
 * sign-up, for terms the account hasn't scheduled yet, then clears the cookie.
 * Only callable from Server Actions.
 */
export async function adoptGuestSchedule(userId: string): Promise<void> {
  const guest = await readCookie();
  const terms = Object.keys(guest).filter((term) => guest[term].length > 0);
  if (terms.length === 0) return;
  const existing = await requireSql()`select term from schedule_sections where user_id = ${userId}`;
  const taken = new Set(existing.map((r) => r.term as string));
  for (const term of terms) if (!taken.has(term)) await saveAccountSchedule(userId, term, guest[term]);
  (await cookies()).delete(SCHEDULE_COOKIE);
}
