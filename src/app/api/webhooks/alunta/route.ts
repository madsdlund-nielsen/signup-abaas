/**
 * Alunta-webhook-endpoint (Fase 3) — ADR 0027-mønstret genbrugt fra Cal.com:
 * rå body → signatur → idempotensrække FØR mutation → mutér. Manglende secret/Supabase →
 * 503, aldrig fail-open. Webhooks OPRETTER aldrig charges/memberships — de opdaterer status
 * (Supabase er sandhedskilde; §5.9: "betaling gennemført/fejlet → opdaterer status").
 *
 * TODO(mads): header-navn og payload-form er provisoriske indtil dataflow-afsøgningen
 * (ADR 0029) — justeringer hører til i src/server/charges/webhook.ts, ikke her.
 */

import { getAdapters } from "@/lib";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { mapAluntaEvent, parseAluntaEvent, verifyAluntaSignature } from "@/server/charges/webhook";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ALUNTA_WEBHOOK_SECRET;
  const config = readSupabaseAuthConfig();
  if (!secret || !isSupabaseAuthConfigured(config)) {
    return new Response("Webhook er ikke konfigureret.", { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyAluntaSignature(rawBody, request.headers.get("x-alunta-signature"), secret)) {
    return new Response("Ugyldig signatur.", { status: 401 });
  }

  let event;
  try {
    event = parseAluntaEvent(JSON.parse(rawBody));
  } catch {
    event = null;
  }
  if (!event) {
    return new Response("Ignoreret (ukendt event-form).", { status: 200 });
  }

  const service = createServiceSupabase(config);
  const analytics = getAdapters().analytics;

  const { error: eventError } = await service.from("payment_webhook_event").insert({
    provider: "alunta",
    provider_event_id: event.eventId,
    event_type: event.type,
    provider_charge_ref: event.chargeRef ?? null,
  });
  if (eventError) {
    if (eventError.code === "23505") {
      return new Response("Allerede behandlet.", { status: 200 });
    }
    await analytics.captureException(new Error(eventError.message), {
      source: "alunta-webhook",
      step: "event-insert",
      type: event.type,
    });
    return new Response("Kunne ikke registrere event.", { status: 500 });
  }

  const mutation = mapAluntaEvent(event);
  if (!mutation) {
    return new Response("Ignoreret (manglende reference).", { status: 200 });
  }

  if (mutation.kind === "charge") {
    const { data, error } = await service
      .from("payment_charge")
      .update({ ...mutation.update, updated_at: new Date().toISOString() })
      .eq("provider_charge_ref", mutation.chargeRef)
      .select("id");
    if (error) {
      await analytics.captureException(new Error(error.message), {
        source: "alunta-webhook",
        step: "charge-update",
        chargeRef: mutation.chargeRef,
      });
      return new Response("Kunne ikke anvende event.", { status: 500 });
    }
    if (!data || data.length === 0) {
      await analytics.capture({
        event: "alunta_webhook_ukendt_charge",
        distinctId: "system",
        properties: { chargeRef: mutation.chargeRef, type: event.type },
      });
    }
  } else {
    const { data, error } = await service
      .from("membership")
      .update({ card_status: "registreret", updated_at: new Date().toISOString() })
      .eq("provider_customer_ref", mutation.customerRef)
      .select("id");
    if (error) {
      await analytics.captureException(new Error(error.message), {
        source: "alunta-webhook",
        step: "card-update",
        customerRef: mutation.customerRef,
      });
      return new Response("Kunne ikke anvende event.", { status: 500 });
    }
    if (!data || data.length === 0) {
      await analytics.capture({
        event: "alunta_webhook_ukendt_kunde",
        distinctId: "system",
        properties: { customerRef: mutation.customerRef },
      });
    }
  }

  return new Response("OK", { status: 200 });
}
