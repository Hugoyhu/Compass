/**
 * Applies SQL migrations in order, once each.
 *
 *   npm run db:migrate              # core migrations (db/migrations/*.sql)
 *   npm run db:migrate -- --tiger   # also Tiger Data extras (db/migrations/tiger/*.sql)
 *
 * Each file runs in its own transaction and is recorded in schema_migrations.
 * Reads DATABASE_URL from the environment or .env.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const folders = ["db/migrations", ...(process.argv.includes("--tiger") ? ["db/migrations/tiger"] : [])];
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));

    for (const folder of folders) {
      if (!existsSync(folder)) continue;
      for (const file of readdirSync(folder).filter((f) => f.endsWith(".sql")).sort()) {
        const name = path.join(folder, file);
        if (applied.has(name)) continue;
        await sql.begin(async (tx) => {
          await tx.unsafe(readFileSync(name, "utf8"));
          await tx`insert into schema_migrations (name) values (${name})`;
        });
        console.log(`✓ applied ${name}`);
      }
    }
    console.log("Migrations up to date");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
