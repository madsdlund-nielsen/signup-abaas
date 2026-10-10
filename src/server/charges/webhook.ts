/**
 * Webhook-ingest for Alunta (Fase 3, ADR 0032 — VERIFICERET mod OpenAPI-spec'en; omlagt til
 * abonnementsmodellen i ADR 0056).
 * Ren kerne adskilt fra route handleren (ADR 0027-mønstret): signatur, event-id og
 * mapping er unit-testbare uden HTTP/DB.
 *
 * Verificeret form (spec'en, webhooks-afsnittet):
 *   - Header `Signature`: HMAC-SHA256 hex over RÅ body, konstant-tids-sammenligning.
 *   - Payload-rod: { event, team_uuid, timestamp, data, test_mode? } (ADR 0032 sagde team_id;
 *     spec'en siger nu team_uuid — begge accepteres, ingen af dem bruges). Nøglen til
 *     idempotens: det stabile `webhook_uuid` (rod) eller `data.event_id` når Alunta sender dem
 *     (spec'en: "primary idempotency key" / stabilt pr. transition på invoice.paid,
 *     checkout.completed, subscription.started/ended m.fl.). Ellers — ADR 0032's afledte nøgle
 *     (event, primær ressource-uuid, timestamp), samme greb som Cal.com (ADR 0027). Alunta
 *     genleverer op til 8 gange over ~24 t; genleverancer preller af på unique-constrainten.
 *   - `test_mode` behandles ens (testmiljø-verifikation kræver reelle mutationer).
 *
 * Sikkerhedskrav (stub-politik — må ALDRIG stubbes): signaturverifikation + idempotens.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type AluntaEventType =
  | "checkout.completed"
  | "invoice.created"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "invoice.refunded"
  | "subscription.payment_failed"
  | "subscription.cancelled"
  | "subscription.ended"
  | "customer.usage_recorded";

const KNOWN_EVENTS: ReadonlySet<string> = new Set([
  "checkout.completed",
  "invoice.created",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.refunded",
  "subscription.payment_failed",
  "subscription.cancelled",
  "subscription.ended",
  "customer.usage_recorded",
]);

export interface AluntaWebhookPayload {
  event: AluntaEventType;
  team_id?: number;
  team_uuid?: string;
  timestamp: string;
  /** Stabil leverance-uuid (marketplace-leverancer) — foretrukket idempotensnøgle når den findes. */
  webhook_uuid?: string;
  data: {
    /** Stabil dedup-nøgle pr. lokal transition (invoice.paid, checkout.completed m.fl.). */
    event_id?: string;
    customer?: { uuid?: string };
    invoice?: { uuid?: string };
    subscription?: { uuid?: string };
    error?: { message?: string } | string;
    external_customer_id?: string;
    type?: string;
  };
  test_mode?: boolean;
}

/** HMAC-SHA256(hex) over rå body — verificeret: Aluntas `Signature`-header. */
export function verifyAluntaSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse + strukturel validering mod spec'ens WebhookPayload. Null → 200 + ignorér. */
export function parseAluntaEvent(json: unknown): AluntaWebhookPayload | null {
  const candidate = json as Partial<AluntaWebhookPayload> | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.event !== "string" || !KNOWN_EVENTS.has(candidate.event)) return null;
  if (typeof candidate.timestamp !== "string" || !candidate.timestamp) return null;
  if (!candidate.data || typeof candidate.data !== "object") return null;
  return candidate as AluntaWebhookPayload;
}

/** Den primære ressource-uuid pr. event-type — indgår i den afledte idempotensnøgle. */
export function primaryUuid(payload: AluntaWebhookPayload): string {
  const { data } = payload;
  if (payload.event.startsWith("invoice.")) return data.invoice?.uuid ?? "ukendt";
  if (payload.event.startsWith("subscription.")) return data.subscription?.uuid ?? "ukendt";
  return data.customer?.uuid ?? "ukendt";
}

/**
 * Idempotensnøgle: genleverance = samme nøgle; ny hændelse = ny nøgle. Foretræk leverandørens
 * egne stabile id'er; afled ellers deterministisk (ADR 0032). Præfikset holder de tre
 * nøgletyper adskilt, så de aldrig kan kollidere på tværs.
 */
export function buildEventId(payload: AluntaWebhookPayload): string {
  if (payload.webhook_uuid) return `delivery:${payload.webhook_uuid}`;
  if (payload.data.event_id) return `${payload.event}:event:${payload.data.event_id}`;
  return `${payload.event}:${primaryUuid(payload)}:${payload.timestamp}`;
}

/** Mutationstyper — routen udfører; kernen beslutter. Webhooks opdaterer, opretter aldrig. */
export type AluntaMutation =
  | {
      kind: "card_registered";
      /** membership.id (vores external_customer_id) + Aluntas customer-uuid der kobles på. */
      externalCustomerId: string;
      aluntaCustomerUuid: string;
      /** Abonnementet checkouten oprettede (B-19): det er det vi sætter prisen på. Null hvis
       *  payloaden ikke bærer det — så kobles kun kunden, og synkroniseringen fejler højlydt. */
      aluntaSubscriptionUuid: string | null;
    }
  | {
      kind: "invoice_paid";
      /** Aluntas customer-uuid → membership.provider_customer_ref; fakturaen afregner
       *  membershipets rapporterede periode-opkrævninger (aggregat, ADR 0032/0056). */
      aluntaCustomerUuid: string;
      invoiceUuid: string;
    }
  | {
      kind: "invoice_failed";
      aluntaCustomerUuid: string;
      invoiceUuid: string;
      failureReason: string;
    }
  | { kind: "membership_cancelled"; aluntaCustomerUuid: string }
  | { kind: "ignore"; reason: string };

export function mapAluntaEvent(payload: AluntaWebhookPayload): AluntaMutation {
  const { data } = payload;
  const customerUuid = data.customer?.uuid;

  switch (payload.event) {
    case "checkout.completed": {
      if (data.type && data.type !== "subscription") {
        return { kind: "ignore", reason: `checkout-type '${data.type}' bruges ikke` };
      }
      if (!data.external_customer_id || !customerUuid) {
        return { kind: "ignore", reason: "checkout.completed uden external_customer_id/customer" };
      }
      return {
        kind: "card_registered",
        externalCustomerId: data.external_customer_id,
        aluntaCustomerUuid: customerUuid,
        aluntaSubscriptionUuid: data.subscription?.uuid ?? null,
      };
    }
    case "invoice.paid": {
      if (!customerUuid || !data.invoice?.uuid) {
        return { kind: "ignore", reason: "invoice.paid uden customer/invoice" };
      }
      return { kind: "invoice_paid", aluntaCustomerUuid: customerUuid, invoiceUuid: data.invoice.uuid };
    }
    case "invoice.payment_failed": {
      if (!customerUuid || !data.invoice?.uuid) {
        return { kind: "ignore", reason: "invoice.payment_failed uden customer/invoice" };
      }
      const error = data.error;
      return {
        kind: "invoice_failed",
        aluntaCustomerUuid: customerUuid,
        invoiceUuid: data.invoice.uuid,
        failureReason:
          (typeof error === "string" ? error : error?.message) ?? "Betaling fejlede hos leverandøren",
      };
    }
    case "subscription.cancelled":
    case "subscription.ended": {
      if (!customerUuid) return { kind: "ignore", reason: `${payload.event} uden customer` };
      return { kind: "membership_cancelled", aluntaCustomerUuid: customerUuid };
    }
    case "invoice.created":
    case "invoice.refunded":
    case "subscription.payment_failed":
    case "customer.usage_recorded":
      // Registreres (idempotensrækken) men muterer ikke: created afventer paid; refunded
      // og payment_failed-retries er drift/fase-4-notifikationsstof; usage_recorded hører til
      // den afløste usage-model (ADR 0034) og forekommer ikke længere.
      // TODO(mads): subscription.payment_succeeded/started findes i spec'en og kunne drive
      // statusskift pr. periode i stedet for invoice.paid — afklares ved live-verifikation.
      return { kind: "ignore", reason: `${payload.event} registreres uden mutation` };
  }
}
