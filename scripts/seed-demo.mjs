#!/usr/bin/env node
/**
 * Kører en seed-fil mod DATABASE_URL. Bruges af `npm run db:seed:demo` og
 * `db:seed:demo:clean`. Bevidst adskilt fra migrationerne: demodata er IKKE skema,
 * og må aldrig køre automatisk som en del af en deploy.
 *
 * Bruger `pg` direkte (samme som tests/setup/db-global.ts), så der ikke kræves psql
 * installeret lokalt.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] === "clean" ? "demo-clean.sql" : "demo.sql";
const sqlPath = join(here, "..", "supabase", "seed", file);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL mangler.\n" +
      "Sæt den til Supabase-projektets connection string (se .env.example) og kør igen.\n" +
      "Kør ALDRIG demodata mod produktion med rigtige kunder.",
  );
  process.exit(1);
}

// Vis hvilken database vi rammer — uden at printe passwordet.
const safeTarget = url.replace(/\/\/[^@]*@/, "//***@");

async function main() {
  const sql = readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.info(`[seed] kører ${file} mod ${safeTarget}`);
    await client.query(sql);

    const { rows } = await client.query(`
      select
        (select count(*) from quiz_question   where id::text like 'd0000000-0000-4000-8000-%') as spoergsmaal,
        (select count(*) from quiz_option     where id::text like 'd0000000-0000-4000-8000-%') as svarmuligheder,
        (select count(*) from partner_profile where id::text like 'd0000000-0000-4000-8000-%') as partnere
    `);
    const { spoergsmaal, svarmuligheder, partnere } = rows[0];
    console.info(
      `[seed] færdig — demodata i basen nu: ${spoergsmaal} spørgsmål, ` +
        `${svarmuligheder} svarmuligheder, ${partnere} partnerprofiler.`,
    );
    if (file === "demo.sql") {
      console.info(
        "[seed] BEMÆRK: der er bevidst IKKE seedet prisregler — beløb er ejer-territorium\n" +
          "[seed]          (docs/stub-politik.md). Admin opretter den første version i /admin/priser.",
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[seed] fejlede: ${error.message}`);
  process.exit(1);
});
