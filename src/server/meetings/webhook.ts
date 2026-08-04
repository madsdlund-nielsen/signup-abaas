/**
 * Webhook-ingest for Cal.com (Fase 2, ADR 0027) — den RENE kerne, adskilt fra route
 * handleren så signatur, event-id og mapping kan unit-testes uden HTTP/DB.
 *
 * Sikkerhedskrav (stub-politik — må ALDRIG stubbes):
 *   - Signaturverifikation: HMAC-SHA256 over den RÅ body med CALCOM_WEBHOOK_SECRET,
 *     sammenlignet konstant-tids. Mangler secret'en, behandles INTET (503, ikke fail-open).
 *   - Idempotens: unique-constrainten på meeting_webhook_event (0012) er mekanismen;
 *     event-id'et her er deterministisk pr. leverance, så gentagne leverancer kolliderer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CalcomTrigger = "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED";

export interface CalcomWebhookEvent {
  triggerEvent: CalcomTrigger;
  createdAt: string;
  payload: {
    uid: string;
    /** Ved reschedule: uid på den GAMLE booking (Cal.com udsteder ny uid). */
    rescheduleUid?: string;
    startTime?: string;
    videoCallUrl?: string;
  };
}

/** HMAC-SHA256(hex) over rå body — Cal.com sender signaturen i `x-cal-signature-256`. */
export function verifyCalcomSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministisk idempotensnøgle pr. leverance: Cal.com sender intet stabilt event-id, så
 * nøglen afledes af (trigger, uid, createdAt) — en GENLEVERANCE af samme event giver samme
 * nøgle og preller af på unique-constrainten; en NY hændelse på samme booking har nyt createdAt.
 */
export function buildEventId(event: CalcomWebhookEvent): string {
  return `${event.triggerEvent}:${event.payload.uid}:${event.createdAt}`;
}

/** Parse + strukturel validering. Null ved ukendt/ugyldig form — handleren logger og ignorerer. */
export function parseCalcomEvent(json: unknown): CalcomWebhookEvent | null {
  const candidate = json as Partial<CalcomWebhookEvent> | null;
  if (!candidate || typeof candidate !== "object") return null;
  const trigger = candidate.triggerEvent;
  if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED" && trigger !== "BOOKING_CANCELLED") {
    return null;
  }
  if (typeof candidate.createdAt !== "string" || !candidate.createdAt) return null;
  const payload = candidate.payload;
  if (!payload || typeof payload.uid !== "string" || !payload.uid) return null;
  return candidate as CalcomWebhookEvent;
}

export interface MeetingMutation {
  /** uid der matcher meeting.provider_booking_uid (ved reschedule: den gamle uid). */
  matchUid: string;
  update: {
    provider_booking_uid?: string;
    starts_at?: string;
    status?: "aflyst";
    video_join_url?: string;
  };
}

/** Oversæt et verificeret event til én meeting-opdatering. Supabase vinder på status/noter/honorar. */
export function mapEventToMutation(event: CalcomWebhookEvent): MeetingMutation {
  switch (event.triggerEvent) {
    case "BOOKING_CREATED": {
      const update: MeetingMutation["update"] = {};
      if (event.payload.startTime) update.starts_at = event.payload.startTime;
      if (event.payload.videoCallUrl) update.video_join_url = event.payload.videoCallUrl;
      return { matchUid: event.payload.uid, update };
    }
    case "BOOKING_RESCHEDULED":
      return {
        matchUid: event.payload.rescheduleUid ?? event.payload.uid,
        update: {
          provider_booking_uid: event.payload.uid,
          ...(event.payload.startTime ? { starts_at: event.payload.startTime } : {}),
        },
      };
    case "BOOKING_CANCELLED":
      return { matchUid: event.payload.uid, update: { status: "aflyst" } };
  }
}
