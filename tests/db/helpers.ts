import { Client } from "pg";

const DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/abaas_test";

/**
 * Kør fn som rollen app_authenticated med en given auth.uid() (eller anonym hvis
 * null). Alt sker i en transaktion der rulles tilbage, så tests er isolerede.
 */
export async function asUser<T>(
  sub: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role app_authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    await client.end();
  }
}

/**
 * Kør fn som DB-ejeren (postgres, uden rolleskift → RLS bypasses), i en transaktion der
 * rulles tilbage. Til test af schema-mekanik der ikke handler om RLS — fx triggere.
 */
export async function asPostgres<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    await client.end();
  }
}
