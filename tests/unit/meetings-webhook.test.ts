import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEventId,
  mapEventToMutation,
  parseCalcomEvent,
  verifyCalcomSignature,
  type CalcomWebhookEvent,
} from "@/server/meetings/webhook";

const SECRET = "test-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function event(overrides: Partial<CalcomWebhookEvent> = {}): CalcomWebhookEvent {
  return {
    triggerEvent: "BOOKING_CREATED",
    createdAt: "2026-08-04T10:00:00Z",
    payload: { uid: "cal-uid-1", startTime: "2026-09-01T10:00:00Z" },
    ...overrides,
  };
}

describe("webhook-signatur (HMAC — må aldrig stubbes)", () => {
  it("gyldig signatur over rå body verificerer", () => {
    const body = JSON.stringify(event());
    expect(verifyCalcomSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("NEGATIV: forkert secret, manipuleret body eller manglende signatur afvises", () => {
    const body = JSON.stringify(event());
    expect(verifyCalcomSignature(body, sign(body, "andet-secret"), SECRET)).toBe(false);
    expect(verifyCalcomSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyCalcomSignature(body, null, SECRET)).toBe(false);
    expect(verifyCalcomSignature(body, "00", SECRET)).toBe(false);
  });
});

describe("idempotensnøgle", () => {
  it("samme leverance giver samme nøgle; ny hændelse på samme booking giver ny", () => {
    const first = event();
    expect(buildEventId(first)).toBe(buildEventId(event()));
    expect(buildEventId(event({ createdAt: "2026-08-04T11:00:00Z" }))).not.toBe(buildEventId(first));
    expect(buildEventId(event({ triggerEvent: "BOOKING_CANCELLED" }))).not.toBe(buildEventId(first));
  });
});

describe("parseCalcomEvent", () => {
  it("accepterer de tre kendte triggere", () => {
    for (const trigger of ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"] as const) {
      expect(parseCalcomEvent(event({ triggerEvent: trigger }))).not.toBeNull();
    }
  });

  it("NEGATIV: ukendt trigger, manglende uid/createdAt eller ikke-objekt → null", () => {
    expect(parseCalcomEvent({ ...event(), triggerEvent: "MEETING_ENDED" })).toBeNull();
    expect(parseCalcomEvent({ ...event(), payload: {} })).toBeNull();
    expect(parseCalcomEvent({ ...event(), createdAt: undefined })).toBeNull();
    expect(parseCalcomEvent(null)).toBeNull();
    expect(parseCalcomEvent("streng")).toBeNull();
  });
});

describe("mapEventToMutation (Supabase vinder på status/noter/honorar)", () => {
  it("CREATED opdaterer starttid + videolink på kendt uid", () => {
    const mutation = mapEventToMutation(
      event({ payload: { uid: "u1", startTime: "2026-09-01T10:00:00Z", videoCallUrl: "https://v" } }),
    );
    expect(mutation.matchUid).toBe("u1");
    expect(mutation.update).toEqual({
      starts_at: "2026-09-01T10:00:00Z",
      video_join_url: "https://v",
    });
  });

  it("RESCHEDULED matcher den GAMLE uid og skriver den nye", () => {
    const mutation = mapEventToMutation(
      event({
        triggerEvent: "BOOKING_RESCHEDULED",
        payload: { uid: "ny-uid", rescheduleUid: "gammel-uid", startTime: "2026-09-02T10:00:00Z" },
      }),
    );
    expect(mutation.matchUid).toBe("gammel-uid");
    expect(mutation.update).toEqual({
      provider_booking_uid: "ny-uid",
      starts_at: "2026-09-02T10:00:00Z",
    });
  });

  it("RESCHEDULED uden rescheduleUid falder tilbage på uid", () => {
    const mutation = mapEventToMutation(
      event({ triggerEvent: "BOOKING_RESCHEDULED", payload: { uid: "u1" } }),
    );
    expect(mutation.matchUid).toBe("u1");
  });

  it("CANCELLED sætter kun status = aflyst", () => {
    const mutation = mapEventToMutation(
      event({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "u1" } }),
    );
    expect(mutation.update).toEqual({ status: "aflyst" });
  });
});
