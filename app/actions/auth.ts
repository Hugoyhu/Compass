"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { accountsEnabled, endSession, startSession } from "@/lib/auth/session";
import { requireSql } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { loadAccountRecord, saveAccountRecord } from "@/lib/student/account-records";
import { clearGuestRecord, readGuestRecord } from "@/lib/student/guest-records";

export type AuthState = { error?: string; username?: string };

const UsernameSchema = z
  .string()
  .trim()
  .min(3, "Usernames are at least 3 characters.")
  .max(32, "Usernames are at most 32 characters.")
  .regex(/^[A-Za-z0-9_.-]+$/, "Use letters, numbers, dots, dashes, or underscores.");
const PasswordSchema = z.string().min(8, "Passwords are at least 8 characters.").max(200, "That password is too long.");

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Moves a signed-out visitor's cookie record into their account if the account has none. */
async function adoptGuestRecord(userId: string) {
  const guest = await readGuestRecord();
  if (!guest) return;
  if (!(await loadAccountRecord(userId))) await saveAccountRecord(userId, { ...guest, id: userId });
  await clearGuestRecord();
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const rawUsername = String(formData.get("username") ?? "");
  if (!accountsEnabled()) return { error: "Accounts aren't available on this server.", username: rawUsername };
  if (rateLimited(`signup:${await clientIp()}`, 10, 60 * 60 * 1000)) {
    return { error: "Too many sign-ups from this network. Try again later.", username: rawUsername };
  }

  const username = UsernameSchema.safeParse(rawUsername);
  if (!username.success) return { error: username.error.issues[0].message, username: rawUsername };
  const password = PasswordSchema.safeParse(formData.get("password"));
  if (!password.success) return { error: password.error.issues[0].message, username: rawUsername };
  if (password.data !== formData.get("confirm")) return { error: "The passwords don't match.", username: rawUsername };

  let userId: string;
  try {
    const [row] = await requireSql()`
      insert into users (username, password_hash) values (${username.data}, ${await hashPassword(password.data)})
      returning id`;
    userId = row.id as string;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "That username is taken.", username: rawUsername };
    throw error;
  }

  await startSession(userId);
  await adoptGuestRecord(userId);
  redirect(safeNext(formData.get("next")));
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!accountsEnabled()) return { error: "Accounts aren't available on this server.", username };
  if (rateLimited(`signin:${await clientIp()}:${username.toLowerCase()}`, 10, 15 * 60 * 1000)) {
    return { error: "Too many attempts. Wait a few minutes and try again.", username };
  }

  const [user] = await requireSql()`select id, password_hash from users where lower(username) = lower(${username})`;
  // Verify against a dummy hash for unknown usernames so timing doesn't reveal which accounts exist.
  const valid = await verifyPassword(password, user ? (user.password_hash as string) : await getDummyHash());
  if (!user || !valid) return { error: "Incorrect username or password.", username };

  await startSession(user.id as string);
  await adoptGuestRecord(user.id as string);
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}
