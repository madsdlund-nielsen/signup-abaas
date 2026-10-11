/**
 * Alunta-webhook-endpoint (Fase 3, ADR 0032 — verificeret mod OpenAPI-spec'en; abonnements-
 * semantik fra ADR 0056).
 * ADR 0027-mønstret: rå body → signatur (`Signature`-header, HMAC-SHA256 hex) →
 * idempotensrække FØR mutation → mutér. Manglende secret/Supabase → 503, aldrig
 * fail-open. Alunta genleverer op til 8 gange over ~24 t og kræver 2xx inden 3 sek. —
 * mutationerne her er små og hurtige. Webhooks opdaterer status; de opretter aldrig data.
 */

import { after } from "next/server";

import { getAdapters } from "@/lib";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { copenhagenDate } from "@/server/charges/periods";
import {
  buildEventId,
  mapAluntaEvent,
  parseAluntaEvent,
  verifyAluntaSignature,
} from "@/server/charges/webhook";
import { notifyPaymentFailed } from "@/server/notifications/meetings";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ALUNTA_WEBHOOK_SECRET;
  const config = readSupabaseAuthConfig();
  if (!secret || !isSupabaseAuthConfigured(config)) {
    return new Response("Webhook er ikke konfigureret.", { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyAluntaSignature(rawBody, request.headers.get("signature"), secret)) {
    return new Response("Ugyldig signatur.", { status: 401 });
  }

  let payload;
  try {
    payload = parseAluntaEvent(JSON.parse(rawBody));
  } catch {
    payload = null;
  }
  if (!payload) {
    return new Response("Ignoreret (ukendt event-form).", { status: 200 });
  }

  const service = createServiceSupabase(config);
  const analytics = getAdapters().analytics;

  const { error: eventError } = await service.from("payment_webhook_event").insert({
    provider: "alunta",
    provider_event_id: buildEventId(payload),
    event_type: payload.event,
  });
  if (eventError) {
    if (eventError.code === "23505") {
      return new Response("Allerede behandlet.", { status: 200 });
    }
    await analytics.captureException(new Error(eventError.message), {
      source: "alunta-webhook",
      step: "event-insert",
      event: payload.event,
    });
    return new Response("Kunne ikke registrere event.", { status: 500 });
  }

  const mutation = mapAluntaEvent(payload);
  const fail = async (step: string, message: string): Promise<Response> => {
    // Rul idempotensrækken TILBAGE før 500'eren (ADR 0029). Uden det ville Aluntas
    // genlevering ramme unique-constrainten, kvittere 200 "allerede behandlet" — og
    // eventet ville være tabt for altid uden nogensinde at være anvendt. Konkret:
    // en tabt invoice.paid efterlader en kunde der HAR betalt som ubetalt, og en tabt
    // subscription.cancelled lader os blive ved med at fakturere en opsagt aftale.
    // Idempotens skal betyde "præcis én gang", ikke "højst én gang".
    await service
      .from("payment_webhook_event")
      .delete()
      .eq("provider", "alunta")
      .eq("provider_event_id", buildEventId(payload));
    await analytics.captureException(new Error(message), {
      source: "alunta-webhook",
      step,
      event: payload.event,
    });
    return new Response("Kunne ikke anvende event.", { status: 500 });
  };

  switch (mutation.kind) {
    case "card_registered": {
      // Kunde- og abonnements-uuid kobles på. Abonnementet er det vi siden sætter prisen på
      // (ADR 0056); mangler payloaden det, kobles kun kunden og synkroniseringen fejler højlydt.
      const { data, error } = await service
        .from("membership")
        .update({
          provider_customer_ref: mutation.aluntaCustomerUuid,
          ...(mutation.aluntaSubscriptionUuid
            ? { provider_subscription_ref: mutation.aluntaSubscriptionUuid }
            : {}),
          card_status: "registreret",
          updated_at: new Date().toISOString(),
        })
        .eq("id", mutation.externalCustomerId)
        .select("id");
      if (error) return fail("card-registered", error.message);
      if (!data || data.length === 0) {
        await analytics.capture({
          event: "alunta_webhook_ukendt_membership",
          distinctId: "system",
          properties: { externalCustomerId: mutation.externalCustomerId },
        });
        break;
      }
      // Periodeankeret sættes ÉN gang (dagen kortet blev registreret, dansk dato) og flyttes
      // aldrig: genleverancer og senere kort-skift må ikke forskyde perioderne.
      const { error: anchorError } = await service
        .from("membership")
        .update({ billing_anchor: copenhagenDate(new Date()) })
        .eq("id", mutation.externalCustomerId)
        .is("billing_anchor", null);
      if (anchorError) return fail("billing-anchor", anchorError.message);
      break;
    }
    case "invoice_paid":
    case "invoice_failed": {
      const { data: membership, error: membershipError } = await service
        .from("membership")
        .select("id")
        .eq("provider_customer_ref", mutation.aluntaCustomerUuid)
        .maybeSingle();
      if (membershipError) return fail("membership-lookup", membershipError.message);
      if (!membership) {
        await analytics.capture({
          event: "alunta_webhook_ukendt_kunde",
          distinctId: "system",
          properties: { aluntaCustomerUuid: mutation.aluntaCustomerUuid, event: payload.event },
        });
        break;
      }
      // Fakturaen afregner membershipets RAPPORTEREDE periode-opkrævninger (aggregat, ADR 0032/0056) —
      // kobling pr. enkelt periode findes ikke i payloaden.
      const update =
        mutation.kind === "invoice_paid"
          ? { status: "gennemfoert", provider_invoice_ref: mutation.invoiceUuid }
          : {
              status: "fejlet",
              provider_invoice_ref: mutation.invoiceUuid,
              failure_reason: mutation.failureReason,
            };
      const { data: updated, error } = await service
        .from("payment_charge")
        .update({ ...update, updated_at: new Date().toISOString() })
        .eq("membership_id", (membership as { id: string }).id)
        .eq("status", "rapporteret")
        .select("id");
      if (error) return fail("charge-update", error.message);
      // «Fejlet betaling» til ejeren (B-41, ADR 0057) — efter svaret, så Aluntas 3-sekunders-frist
      // holder, og en notifikationsfejl aldrig gør webhooken rød. Motoren er idempotent pr. træk.
      if (mutation.kind === "invoice_failed") {
        const chargeIds = ((updated ?? []) as Array<{ id: string }>).map((row) => row.id);
        after(async () => {
          for (const chargeId of chargeIds) {
            try {
              await notifyPaymentFailed(service, chargeId);
            } catch (e) {
              console.error(
                `[alunta-webhook] notifikation om fejlet betaling fejlede: ${e instanceof Error ? e.name : "ukendt"}`,
              );
            }
          }
        });
      }
      break;
    }
    case "membership_cancelled": {
      const { error } = await service
        .from("membership")
        .update({ status: "opsagt", updated_at: new Date().toISOString() })
        .eq("provider_customer_ref", mutation.aluntaCustomerUuid);
      if (error) return fail("membership-cancel", error.message);
      // Opsigelsesdatoen afskærer NYE perioder (ADR 0056) og sættes kun første gang, så en
      // genleveret subscription.ended ikke rykker den. Opsigelsesvarsel/refusion er ikke besluttet.
      // TODO(ejer): opsigelsesvarsel.
      const { error: dateError } = await service
        .from("membership")
        .update({ cancelled_at: copenhagenDate(new Date()) })
        .eq("provider_customer_ref", mutation.aluntaCustomerUuid)
        .is("cancelled_at", null);
      if (dateError) return fail("membership-cancel-date", dateError.message);
      break;
    }
    case "ignore":
      break;
  }

  return new Response("OK", { status: 200 });
}
