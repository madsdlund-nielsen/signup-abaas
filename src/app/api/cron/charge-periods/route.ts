/**
 * Planlagt kørsel: opret periode-opkrævninger og meld abonnementsprisen til leverandøren
 * (B-19, ADR 0056). Kaldes dagligt af Netlify scheduled function `netlify/functions/charge-periods.ts`.
 *
 * Beskyttet af en delt hemmelighed i `x-cron-secret` (CRON_SECRET): manglende secret → 503
 * (aldrig fail-open), forkert/manglende header → 401. Sammenligningen er konstant-tid.
 * Kørslen er idempotent (unique `(membership_id, period_start)`), så en dobbeltaflevering eller
 * en manuel genkørsel er ufarlig. Bag FLAG_PAYMENTS som resten af betalingsmodulet.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { getAdapters } from "@/lib";
import { createPaymentProvider } from "@/lib/payments";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { createChargesForDuePeriods } from "@/server/charges/create";
import { syncPendingSubscriptions } from "@/server/charges/sync";
import { isEnabled } from "@/server/flags";

export const dynamic = "force-dynamic";

/** Konstant-tids sammenligning uafhængig af længde: begge sider hashes til samme længde først. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Kørslen er ikke konfigureret (CRON_SECRET mangler).", { status: 503 });
  if (!secretMatches(request.headers.get("x-cron-secret"), secret)) {
    return new Response("Ugyldig hemmelighed.", { status: 401 });
  }

  if (!isEnabled("payments")) {
    return Response.json({ skipped: "FLAG_PAYMENTS er slået fra." });
  }
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) {
    return new Response("Supabase er ikke konfigureret.", { status: 503 });
  }

  const service = createServiceSupabase(config);
  try {
    const periods = await createChargesForDuePeriods(service, new Date());
    // Synkroniseringen er et eget skridt: en stub uden nøgler må ikke fælde oprettelsen af
    // opkrævningerne — de står blot som 'afventer' indtil nøglerne kommer.
    const sync = await syncPendingSubscriptions(service, createPaymentProvider());
    return Response.json({ periods, sync });
  } catch (e) {
    await getAdapters().analytics.captureException(e instanceof Error ? e : new Error(String(e)), {
      source: "charge-periods-cron",
    });
    return new Response("Kørslen fejlede.", { status: 500 });
  }
}
