import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/abaas_test";

function sqlFile(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

function sqlDir(relDir: string): string[] {
  const dir = join(process.cwd(), relDir);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

/**
 * Global setup for db-projektet: nulstil databasen og anvend
 * auth-shim → migrationer → policies → app-rolle/grants/seed.
 */
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade; create schema public;");
    await client.query("drop schema if exists auth cascade;");

    await client.query(sqlFile("tests/setup/auth-shim.sql"));
    for (const sql of sqlDir("supabase/migrations")) await client.query(sql);
    for (const sql of sqlDir("supabase/policies")) await client.query(sql);
    await client.query(sqlFile("tests/setup/seed.sql"));
  } finally {
    await client.end();
  }
}
