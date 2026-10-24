/**
 * Accounts and sessions (data access layer). Every read of "who is signed in"
 * goes through getCurrentUser(); Server Actions call it again before touching
 * account data rather than trusting anything from the client.
 *
 * The session cookie holds a random 256-bit token; the database stores only
 * its SHA-256 hash, so a database leak doesn't expose usable sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { databaseConfigured, getSql, requireSql } from "@/lib/db/client";

export const SESSION_COOKIE = "compass_session";
const SESSION_DAYS = 30;

export interface CurrentUser {
  id: string;
  username: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The signed-in user, or null. Request-time API: call it inside a <Suspense> boundary. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const sql = getSql();
  if (!token || !sql) return null;
  const [row] = await sql`
    select u.id, u.username
    from sessions s join users u on u.id = s.user_id
    where s.id = ${hashToken(token)} and s.expires_at > now()`;
  return row ? { id: row.id as string, username: row.username as string } : null;
}

/** Creates a session and sets its cookie. Only callable from Server Actions. */
export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await requireSql()`insert into sessions (id, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expires})`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
}

/** Deletes the current session (server-side and cookie). Only callable from Server Actions. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const sql = getSql();
  if (token && sql) await sql`delete from sessions where id = ${hashToken(token)}`;
  store.delete(SESSION_COOKIE);
}

export function accountsEnabled(): boolean {
  return databaseConfigured();
}
