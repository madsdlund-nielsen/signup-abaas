/**
 * Planlagt kørsel: generér AI-opsummeringer af afholdte møder i baggrunden (B-45, ADR 0059).
 * Kaldes af Netlify scheduled function `netlify/functions/summaries.ts`.
 *
 * Beskyttet af en delt hemmelighed i `x-cron-secret` (CRON_SECRET) — præcis som
 * `/api/cron/charge-periods` (ADR 0056): manglende secret → 503 (aldrig fail-open),
 * forkert/manglende header → 401, konstant-tids sammenligning. No-op når FLAG_AIFOLLOWUP er
 * slukket. Kørslen er idempotent (rækken låses med en betinget status-overgang), så en
 * dobbeltaflevering eller manuel genkørsel er ufarlig. Er flaget tændt men en port stadig en
 * stub, svarer routen 503 — et synligt hul, ikke en stille succes.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { getAdapters } from "@/lib";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { isEnabled } from "@/server/flags";
import { generatePendingSummaries } from "@/server/summaries/generate";

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

  if (!isEnabled("aiFollowup")) {
    return Response.json({ skipped: "FLAG_AIFOLLOWUP er slået fra." });
  }
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) {
    return new Response("Supabase er ikke konfigureret.", { status: 503 });
  }

  const service = createServiceSupabase(config);
  try {
    const result = await generatePendingSummaries(service, new Date());
    if (result.notConfigured) {
      return new Response(
        "AI-opfølgning er ikke konfigureret (Ordbogen-nøgle eller transskriptions-flag mangler).",
        { status: 503 },
      );
    }
    return Response.json(result);
  } catch (e) {
    await getAdapters().analytics.captureException(e instanceof Error ? e : new Error(String(e)), {
      source: "summaries-cron",
    });
    return new Response("Kørslen fejlede.", { status: 500 });
  }
}
