import { describe, expect, it } from "vitest";
import { getAdapters, NotConfiguredError } from "@/lib";

const emptyEnv: Record<string, string | undefined> = {};

describe("adapter-registry uden nøgler/flag", () => {
  it("returnerer stubs for alle sub-processorer", () => {
    const adapters = getAdapters(emptyEnv);
    for (const adapter of Object.values(adapters)) {
      expect(adapter.name).toBe("stub");
    }
  });

  it("fire-and-forget-stub (email) logger og resolver uden at kaste", async () => {
    const { email } = getAdapters(emptyEnv);
    await expect(
      email.send({ to: "x@y.dk", subject: "hej", body: "test" }),
    ).resolves.toBeUndefined();
  });

  it("backend-stub (payments) kaster NotConfiguredError", async () => {
    const { payments } = getAdapters(emptyEnv);
    await expect(
      payments.reportUsageCharge({
        customerRef: "c1",
        amountMinor: 1000,
        idempotencyKey: "test-key",
        description: "test",
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("booking-stub kaster NotConfiguredError (multi-host-spike ikke afsluttet)", async () => {
    const { booking } = getAdapters(emptyEnv);
    await expect(
      booking.createMultiHostMeeting({
        ownerUserId: "o",
        partnerUserIds: ["p1", "p2"],
        startsAt: "2026-10-01T09:00:00Z",
        durationMinutes: 75,
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

/**
 * Demo-tilstand (ADR 0041): tredje implementering ved siden af rigtig og stub. De tre
 * første cases er sikkerhedsreglen — (b) er den vigtige: rigtige nøgler vinder altid,
 * så demo kan aldrig skygge for en konfigureret integration.
 */
const demoEnv: Record<string, string | undefined> = { FLAG_DEMO: "true" };
const BACKEND_PORTS = ["booking", "video", "payments", "accounting", "llm", "transcription"] as const;
const FIRE_AND_FORGET_PORTS = ["email", "sms", "analytics"] as const;

describe("demo-tilstand (ADR 0041)", () => {
  it("(a) vælger demo for alle backend-porte når rigtig config mangler", () => {
    const adapters = getAdapters(demoEnv);
    for (const port of BACKEND_PORTS) {
      expect(adapters[port].name, port).toBe("demo");
    }
  });

  it("(b) skygger aldrig for en konfigureret integration — rigtige nøgler vinder", () => {
    const { booking, payments } = getAdapters({
      ...demoEnv,
      FLAG_BOOKING: "true",
      CALCOM_API_KEY: "test-key",
      CALCOM_EVENT_TYPE_ID: "1",
      FLAG_PAYMENTS: "true",
      ALUNTA_API_KEY: "test-key",
      ALUNTA_PLAN_ID: "plan",
    });
    expect(booking.name).toBe("calcom");
    expect(payments.name).toBe("alunta");
  });

  it("(c) er inaktiv uden FLAG_DEMO — stub-adfærden er uændret", () => {
    const adapters = getAdapters({});
    for (const port of BACKEND_PORTS) {
      expect(adapters[port].name, port).toBe("stub");
    }
  });

  it("rører ikke fire-and-forget-portene — de logger og resolver allerede", () => {
    const adapters = getAdapters(demoEnv);
    for (const port of FIRE_AND_FORGET_PORTS) {
      expect(adapters[port].name, port).toBe("stub");
    }
  });

  it("demo-booking bekræfter tidspunktet og peger Deltag på appens eget møderum", async () => {
    const { booking } = getAdapters(demoEnv);
    const scheduled = await booking.createMultiHostMeeting({
      ownerUserId: "o",
      partnerUserIds: ["p1", "p2"],
      startsAt: "2026-10-01T09:00:00Z",
      durationMinutes: 75,
    });
    expect(scheduled.uid).toMatch(/^DEMO-BOOKING-/);
    expect(scheduled.startsAt).toBe("2026-10-01T09:00:00Z");
    expect(scheduled.joinUrl).toBe(`/moeder/rum/${scheduled.uid}`);
    await expect(booking.cancelMeeting(scheduled.uid)).resolves.toBeUndefined();
  });

  it("demo-betaling sender til appens demo-checkout for netop det medlemskab", async () => {
    const { payments } = getAdapters(demoEnv);
    const session = await payments.registerCard({ customerRef: "membership-1" });
    expect(session.id).toMatch(/^DEMO-CHECKOUT-/);
    expect(session.url).toBe("/betaling/demo-kort/membership-1");
    const charge = await payments.reportUsageCharge({
      customerRef: "DEMO-CUSTOMER-membership-1",
      amountMinor: 1000,
      idempotencyKey: "k",
      description: "test",
    });
    expect(charge.id).toMatch(/^DEMO-CHARGE-/);
  });

  it("demo-tekster er mærket [DEMO], så de aldrig kan læses som ægte indhold", async () => {
    const { llm, transcription } = getAdapters(demoEnv);
    const summary = await llm.summarizeMeeting({ meetingId: "m", transcript: "" });
    expect(summary.summary.startsWith("[DEMO]")).toBe(true);
    expect(summary.actionItems.length).toBeGreaterThan(0);
    for (const item of summary.actionItems) expect(item.startsWith("[DEMO]")).toBe(true);
    const transcript = await transcription.transcribe({ meetingId: "m", audioRef: "a" });
    expect(transcript.text.startsWith("[DEMO]")).toBe(true);
    expect(transcript.language).toBe("da-DK");
  });
});
