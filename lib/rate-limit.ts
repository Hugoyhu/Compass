import { headers } from "next/headers";

/**
 * Best-effort, per server instance. Good enough to slow down abuse of a
 * hackathon deployment; use a shared store (e.g. the database) if it matters.
 */
const buckets = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  buckets.set(key, [...recent, now]);
  return false;
}

export async function clientIp(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
