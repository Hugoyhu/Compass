/**
 * Postgres connection. Plain connection string (DATABASE_URL), no vendor SDK,
 * so the same code runs against Tiger Data now and Supabase later.
 */
import postgres from "postgres";

let client: postgres.Sql | null | undefined;

/** The shared client, or null when DATABASE_URL isn't set (accounts are then unavailable). */
export function getSql(): postgres.Sql | null {
  if (client !== undefined) return client;
  const url = process.env.DATABASE_URL;
  client = url
    ? postgres(url, {
        // Small pool: serverless instances each hold their own connections.
        max: Number(process.env.DATABASE_POOL_MAX ?? 5),
        idle_timeout: 20,
        connect_timeout: 15,
        // Transaction-mode poolers (Supabase, Tiger's pooler) don't support prepared statements.
        prepare: process.env.DATABASE_PREPARE === "true",
      })
    : null;
  return client;
}

export function requireSql(): postgres.Sql {
  const sql = getSql();
  if (!sql) throw new Error("DATABASE_URL is not set");
  return sql;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
