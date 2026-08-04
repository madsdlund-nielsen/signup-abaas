/**
 * Webhook-ingest for Alunta-betalingshændelser (Fase 3, ADR 0027-mønstret genbrugt) —
 * den RENE kerne, adskilt fra route handleren så signatur/parse/mapping kan unit-testes.
 *
 * ⚠ PROVISORISK FORM: Aluntas faktiske payload- og signaturskema er uafsøgt.
 * TODO(mads): dataflow-afsøgningen (§12 pkt. 10, ADR 0029) verificerer header-navn,
 * signaturformat og event-form; denne kerne er skrevet leverandørneutralt (HMAC-SHA256
 * hex over rå body + eksplicit event-id) så justeringen er lokal til denne fil.
 *
 * Sikkerhedskrav (stub-politik — må ALDRIG stubbes): signaturverifikation (konstant-tid)
 * og idempotens (unique-constraint på payment_webhook_event, 0013).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type AluntaEventType = "charge.gennemfoert" | "charge.fejlet" | "kort.registreret";

export interface AluntaWebhookEvent {
  /** Leverandørens stabile event-id — idempotensnøglen (modsat Cal.com afledes intet). */
  eventId: string;
  type: AluntaEventType;
  /** Vores charge-reference (payment_charge.provider_charge_ref) hhv. kunde-reference. */
  chargeRef?: string;
  customerRef?: string;
  failureReason?: string;
}

/** HMAC-SHA256(hex) over rå body. Header-navn (route) og format er provisoriske. */
export function verifyAluntaSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse + strukturel validering. Null ved ukendt form — handleren kvitterer 200 og ignorerer. */
export function parseAluntaEvent(json: unknown): AluntaWebhookEvent | null {
  const candidate = json as Partial<AluntaWebhookEvent> | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.eventId !== "string" || !candidate.eventId) return null;
  const type = candidate.type;
  if (type !== "charge.gennemfoert" && type !== "charge.fejlet" && type !== "kort.registreret") {
    return null;
  }
  return candidate as AluntaWebhookEvent;
}

export interface ChargeMutation {
  kind: "charge";
  /** Matcher payment_charge.provider_charge_ref. */
  chargeRef: string;
  update: { status: "gennemfoert" | "fejlet"; failure_reason?: string };
}

export interface CardMutation {
  kind: "card";
  /** Matcher membership.provider_customer_ref. */
  customerRef: string;
}

/** Oversæt et verificeret event til én mutation. Null hvis referencen mangler i payloaden. */
export function mapAluntaEvent(event: AluntaWebhookEvent): ChargeMutation | CardMutation | null {
  switch (event.type) {
    case "charge.gennemfoert":
      return event.chargeRef
        ? { kind: "charge", chargeRef: event.chargeRef, update: { status: "gennemfoert" } }
        : null;
    case "charge.fejlet":
      return event.chargeRef
        ? {
            kind: "charge",
            chargeRef: event.chargeRef,
            update: { status: "fejlet", failure_reason: event.failureReason ?? "Ukendt årsag" },
          }
        : null;
    case "kort.registreret":
      return event.customerRef ? { kind: "card", customerRef: event.customerRef } : null;
  }
}
