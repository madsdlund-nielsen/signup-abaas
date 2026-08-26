/**
 * Cal.com-webhook-endpoint (Fase 2, ADR 0027) — repoets FØRSTE route handler; mønstret her
 * er konventionen for kommende webhooks (Alunta i fase 3).
 *
 * Rækkefølgen er bærende:
 *   1. Rå body læses FØR parse (signaturen dækker rå bytes).
 *   2. Signatur verificeres — ugyldig/manglende → 401. Mangler secret/Supabase → 503,
 *      aldrig fail-open (stub-politik: signaturverifikation må ikke stubbes).
 *   3. Idempotensrækken skrives FØR mutationen — unique-kollision (23505) = allerede
 *      behandlet → 200 uden ny mutation (Cal.com genleverer ved manglende 2xx).
 *   4. Mutation via provider_booking_uid; ukendt uid → logget + ignoreret (webhooks
 *      OPRETTER aldrig møder — Supabase er sandhedskilde, appen opretter).
 */

import { getAdapters } from "@/lib";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import {
  buildEventId,
  mapEventToMutation,
  parseCalcomEvent,
  verifyCalcomSignature,
} from "@/server/meetings/webhook";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  const config = readSupabaseAuthConfig();
  if (!secret || !isSupabaseAuthConfigured(config)) {
    // Bevidst 503 frem for at behandle uverificeret: hellere en død webhook end en åben.
    return new Response("Webhook er ikke konfigureret.", { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyCalcomSignature(rawBody, request.headers.get("x-cal-signature-256"), secret)) {
    return new Response("Ugyldig signatur.", { status: 401 });
  }

  let event;
  try {
    event = parseCalcomEvent(JSON.parse(rawBody));
  } catch {
    event = null;
  }
  if (!event) {
    // Verificeret afsender, ukendt form — kvittér 200 så Cal.com ikke genleverer for evigt.
    return new Response("Ignoreret (ukendt event-form).", { status: 200 });
  }

  const service = createServiceSupabase(config);
  const analytics = getAdapters().analytics;

  const { error: eventError } = await service.from("meeting_webhook_event").insert({
    provider: "calcom",
    provider_event_id: buildEventId(event),
    event_type: event.triggerEvent,
    provider_booking_uid: event.payload.uid,
  });
  if (eventError) {
    if (eventError.code === "23505") {
      return new Response("Allerede behandlet.", { status: 200 });
    }
    await analytics.captureException(new Error(eventError.message), {
      source: "calcom-webhook",
      step: "event-insert",
      trigger: event.triggerEvent,
    });
    return new Response("Kunne ikke registrere event.", { status: 500 });
  }

  const mutation = mapEventToMutation(event);
  const { data, error: updateError } = await service
    .from("meeting")
    .update({ ...mutation.update, updated_at: new Date().toISOString() })
    .eq("provider_booking_uid", mutation.matchUid)
    .select("id");
  if (updateError) {
    // Rul idempotensrækken TILBAGE før 500'eren. Uden det ville Cal.coms genlevering
    // ramme unique-constrainten, kvittere 200 "allerede behandlet" — og eventet ville
    // være tabt for altid, uden nogensinde at være anvendt. Idempotens må ikke betyde
    // "højst én gang"; den skal betyde "præcis én gang".
    await service
      .from("meeting_webhook_event")
      .delete()
      .eq("provider", "calcom")
      .eq("provider_event_id", buildEventId(event));
    await analytics.captureException(new Error(updateError.message), {
      source: "calcom-webhook",
      step: "meeting-update",
      trigger: event.triggerEvent,
      uid: mutation.matchUid,
    });
    return new Response("Kunne ikke anvende event.", { status: 500 });
  }
  if (!data || data.length === 0) {
    // Ukendt booking (fx oprettet direkte i Cal.com) — logget, bevidst IKKE oprettet her.
    await analytics.capture({
      event: "calcom_webhook_ukendt_uid",
      distinctId: "system",
      properties: { trigger: event.triggerEvent, uid: mutation.matchUid },
    });
  }

  return new Response("OK", { status: 200 });
}
