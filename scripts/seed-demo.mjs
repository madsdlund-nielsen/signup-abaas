#!/usr/bin/env node
/**
 * Kører en seed-fil mod DATABASE_URL. Bruges af `npm run db:seed:demo` og
 * `db:seed:demo:clean`. Bevidst adskilt fra migrationerne: demodata er IKKE skema,
 * og må aldrig køre automatisk som en del af en deploy.
 *
 * Bruger `pg` direkte (samme som tests/setup/db-global.ts), så der ikke kræves psql
 * installeret lokalt.
 *
 * DEMO_OWNER_EMAIL (valgfri, ADR 0043): e-mailen på en ejer der allerede har oprettet sig via
 * /signup. Sættes den, seedes også en befolket tilstand for hende — board, medlemskab med
 * demo-kort, et kommende og et afholdt møde — så før/efter-skærme kan klikkes uden gennemspil.
 * Uden den seedes kun quiz + katalog, præcis som før.
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

const ownerEmail = process.env.DEMO_OWNER_EMAIL?.trim() || null;

// Vis hvilken database vi rammer — uden at printe passwordet.
const safeTarget = url.replace(/\/\/[^@]*@/, "//***@");

async function main() {
  const sql = readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  // do-blokken i demo.sql taler via `raise notice` — vis det.
  client.on("notice", (notice) => console.info(notice.message));
  await client.connect();
  try {
    console.info(`[seed] kører ${file} mod ${safeTarget}`);
    if (ownerEmail && file === "demo.sql") {
      // Læses af do-blokken i demo.sql via current_setting('demo.owner_email').
      await client.query("select set_config('demo.owner_email', $1, false)", [ownerEmail]);
      console.info(`[seed] befolket tilstand for ejeren ${ownerEmail}`);
    }
    await client.query(sql);

    const { rows } = await client.query(`
      select
        (select count(*) from quiz_question   where id::text like 'd0000000-0000-4000-8000-%') as spoergsmaal,
        (select count(*) from quiz_option     where id::text like 'd0000000-0000-4000-8000-%') as svarmuligheder,
        (select count(*) from partner_profile where id::text like 'd0000000-0000-4000-8000-%') as partnere,
        (select count(*) from board           where id::text like 'd0000000-0000-4000-8000-%') as boards,
        (select count(*) from meeting         where id::text like 'd0000000-0000-4000-8000-%') as moeder,
        (select count(*) from payment_charge  where id::text like 'd0000000-0000-4000-8000-%') as opkraevninger,
        (select count(*) from pricing_rule    where id::text like 'd0000000-0000-4000-8000-%' and is_active) as demoregler
    `);
    const { spoergsmaal, svarmuligheder, partnere, boards, moeder, opkraevninger, demoregler } = rows[0];
    console.info(
      `[seed] færdig — demodata i basen nu: ${spoergsmaal} spørgsmål, ` +
        `${svarmuligheder} svarmuligheder, ${partnere} partnerprofiler, ` +
        `${boards} board, ${moeder} møder, ${opkraevninger} opkrævninger.`,
    );
    if (file === "demo.sql") {
      if (Number(demoregler) > 0) {
        console.info(
          "[seed] BEMÆRK: en DEMO-prisregel (1,00 kr + 1,00 kr pr. partner) er aktiv — åbenlyst falsk,\n" +
            "[seed]          fjernes af db:seed:demo:clean. Rigtige satser tastes af admin i /admin/priser.",
        );
      } else if (ownerEmail) {
        console.info(
          "[seed] BEMÆRK: ingen demo-prisregel indsat — der fandtes allerede en aktiv regel, og den\n" +
            "[seed]          er ikke rørt. Derfor heller ingen demo-opkrævning (tal er ejer-territorium).",
        );
      } else {
        console.info(
          "[seed] BEMÆRK: der er bevidst IKKE seedet prisregler — beløb er ejer-territorium\n" +
            "[seed]          (docs/stub-politik.md). Admin opretter den første version i /admin/priser.\n" +
            "[seed]          Sæt DEMO_OWNER_EMAIL=<din signup-mail> for også at seede board, medlemskab og møder.",
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[seed] fejlede: ${error.message}`);
  process.exit(1);
});
