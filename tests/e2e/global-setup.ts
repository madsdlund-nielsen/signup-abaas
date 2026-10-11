/**
 * Global opsætning for e2e (fase 6.1, ADR 0071). Kører én gang før specs:
 *
 *   1. Tjek at den lokale Supabase-stak kører (og er loopback — se support/env.ts).
 *   2. `supabase db reset`: alle migrationer 0001… anvendes rent på en tom database. Det er selv en
 *      verifikation — en migration der fejler mod rigtig Supabase (auth-skema, rolle-grants) vælter
 *      opsætningen her. E2E_NO_RESET=1 springer det over (hurtigere gentagne kørsler).
 *   3. Bekræftede testbrugere i Supabase Auth (admin-API) med roller. Ejeren der gennemspiller
 *      rejsen oprettes IKKE her — hun signer op i browseren.
 *   4. Demo-seed'et (`scripts/seed-demo.mjs`, ADR 0043) for en ejer med en befolket tilstand:
 *      quiz, partnerkatalog, board, medlemskab, kommende + afholdt møde, DEMO-prisregel og
 *      DEMO-honorarregel.
 *
 * Intet her rører appens egen kode: alt går gennem de samme scripts og API'er en udvikler bruger.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

import { ensureUser, USERS } from "./support/data";
import { E2E_WORKDIR, loadSupabaseEnv, REPO_ROOT } from "./support/env";

/**
 * `supabase db reset` returnerer før PostgREST har genindlæst skemaet (fund under 6.1: ca. hver
 * anden kørsel fik «Could not find the table 'public.app_user' in the schema cache»). Vent til
 * en tabel fra den SIDSTE migration kan læses, så opsætningen ikke løber ind i det.
 */
async function waitForRest(apiUrl: string, key: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/rest/v1/app_user?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }).catch((error: unknown) => ({ ok: false, status: 0, text: async () => String(error) }));
    if (response.ok) return;
    last = `${response.status} ${await response.text()}`;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`PostgREST er ikke klar efter 60 s: ${last}`);
}

export default async function globalSetup(): Promise<void> {
  const supabase = loadSupabaseEnv();

  const health = await fetch(`${supabase.apiUrl}/auth/v1/health`, {
    headers: { apikey: supabase.publishableKey },
  }).catch(() => null);
  if (!health?.ok) {
    throw new Error("Supabase Auth svarer ikke. Start stakken: `npm run e2e:db:up` (docs/e2e.md).");
  }

  if (!process.env.E2E_NO_RESET) {
    console.info("[e2e] supabase db reset — anvender alle migrationer på en tom database");
    execFileSync("npx", ["--yes", "supabase", "db", "reset", "--workdir", E2E_WORKDIR], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }

  await waitForRest(supabase.apiUrl, supabase.secretKey);

  rmSync(`${REPO_ROOT}tests/e2e/__screens__`, { recursive: true, force: true });
  for (const role of ["ejer", "admin", "partner", "offentlig"]) {
    mkdirSync(`${REPO_ROOT}tests/e2e/__screens__/${role}`, { recursive: true });
  }

  await ensureUser(USERS.admin, "admin");
  await ensureUser(USERS.ejerBefolket, "ejer");

  console.info("[e2e] demo-seed (ADR 0043) for en ejer med befolket tilstand");
  execFileSync("node", ["scripts/seed-demo.mjs"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: supabase.dbUrl, DEMO_OWNER_EMAIL: USERS.ejerBefolket },
  });
}
