/**
 * Planlagt kørsel: send påmindelser og ratinganmodninger (fase 4.5, ADR 0057).
 *
 * ⚠ IKKE PLANLAGT. Ruten findes, men intet kalder den: der er ingen scheduled function, og
 * `netlify.toml` har ingen cron. Det er bevidst — udsendelsestidspunkterne er ejerens
 * beslutning (ADR 0048: `schedule: null` i kataloget). Selv hvis ruten blev kaldt i dag, svarer
 * begge kørsler `ikke-fastlagt` og sender intet. TODO(ejer): fastsæt tidspunkterne i
 * `NOTIFICATION_TYPES`, og planlæg derefter ruten (Netlify scheduled function, som
 * `charge-periods` fra betalingsskiven — samme `x-cron-secret`).
 *
 * Beskyttet af en delt hemmelighed i `x-cron-secret` (CRON_SECRET), samme som de øvrige
 * planlagte ruter: manglende secret → 503 (aldrig fail-open), forkert/manglende header → 401,
 * sammenligningen er konstant-tid. Kørslen er idempotent (idempotensnøglen i
 * `notification_delivery`), så en dobbeltaflevering eller en manuel genkørsel er ufarlig.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { getAdapters } from "@/lib";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { sendMeetingReminders, sendRatingRequests } from "@/server/notifications/meetings";
import { scrubError } from "@/server/notifications/scrub";

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

  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) {
    return new Response("Supabase er ikke konfigureret.", { status: 503 });
  }

  const service = createServiceSupabase(config);
  const now = new Date();

  // Hver kørsel for sig: en fejl i ratinganmodningerne må ikke tage påmindelserne med.
  let failed = false;
  const guarded = async <T>(name: string, run: () => Promise<T>): Promise<T | { fejl: true }> => {
    try {
      return await run();
    } catch (e) {
      failed = true;
      await getAdapters()
        .analytics.captureException(new Error(scrubError(e)), { source: `notifications-cron:${name}` })
        .catch(() => undefined);
      return { fejl: true };
    }
  };

  const reminders = await guarded("reminders", () => sendMeetingReminders(now, service));
  const ratings = await guarded("ratings", () => sendRatingRequests(now, service));
  return Response.json({ reminders, ratings }, { status: failed ? 500 : 200 });
}
