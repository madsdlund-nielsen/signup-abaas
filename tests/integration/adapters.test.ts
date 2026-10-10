import { describe, expect, it } from "vitest";
import { getAdapters, NotConfiguredError } from "@/lib";
import { DEMO_EVENT_TYPE_ID } from "@/lib/booking";

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
    ).resolves.toEqual({ reference: null });
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
        eventTypeId: 1,
        start: "2026-10-01T09:00:00Z",
        attendee: { name: "Ejer", email: "ejer@example.com", timeZone: "Europe/Copenhagen" },
        metadata: {},
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
// E-mail og SMS har siden fase 4.5 en demo (ADR 0057); analytics logger og resolver stadig kun.
const DEMO_FIRE_AND_FORGET_PORTS = ["email", "sms"] as const;

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

  it("giver e-mail og SMS en demo (ADR 0057) — men rører ikke analytics, der stadig bare logger", () => {
    const adapters = getAdapters(demoEnv);
    for (const port of DEMO_FIRE_AND_FORGET_PORTS) {
      expect(adapters[port].name, port).toBe("demo");
    }
    expect(adapters.analytics.name).toBe("stub");
  });

  it("e-mail og SMS: rigtige nøgler vinder over demo, og nøgler uden flag giver stub", () => {
    const real = getAdapters({
      ...demoEnv,
      FLAG_EMAIL: "true",
      RESEND_API_KEY: "test-key",
      RESEND_FROM_ADDRESS: "noreply@example.invalid",
      FLAG_SMS: "true",
      INMOBILE_API_KEY: "test-key",
      INMOBILE_SENDER: "ABaaS",
    });
    expect(real.email.name).toBe("resend");
    expect(real.sms.name).toBe("inmobile");
    // Nøgler uden flag: ikke rigtig, men heller ikke demo — demo vælges kun når config MANGLER.
    const unflagged = getAdapters({
      ...demoEnv,
      RESEND_API_KEY: "test-key",
      RESEND_FROM_ADDRESS: "noreply@example.invalid",
    });
    expect(unflagged.email.name).toBe("stub");
  });

  it("demo-e-mail og -SMS kvitterer med et åbenlyst falsk besked-id", async () => {
    const { email, sms } = getAdapters(demoEnv);
    const mail = await email.send({ to: "x@y.dk", subject: "[DEMO] emne", body: "[DEMO]" });
    const text = await sms.send({ to: "+4500000000", message: "[DEMO]" });
    expect(mail.reference).toMatch(/^DEMO-MSG-/);
    expect(text.reference).toMatch(/^DEMO-MSG-/);
  });

  it("demo-booking bekræfter tidspunktet og peger Deltag på appens eget møderum", async () => {
    const { booking } = getAdapters(demoEnv);
    const scheduled = await booking.createMultiHostMeeting({
      eventTypeId: DEMO_EVENT_TYPE_ID,
      start: "2026-10-01T09:00:00Z",
      attendee: { name: "Ejer", email: "ejer@example.com", timeZone: "Europe/Copenhagen" },
      metadata: {},
    });
    expect(scheduled.uid).toMatch(/^DEMO-BOOKING-/);
    expect(scheduled.startsAt).toBe("2026-10-01T09:00:00Z");
    expect(scheduled.joinUrl).toBe(`/moeder/rum/${scheduled.uid}`);
    await expect(booking.cancelMeeting(scheduled.uid)).resolves.toBeUndefined();
  });

  it("demo-event-type er et åbenlyst falsk id uden for det Cal.com udsteder", async () => {
    const { booking } = getAdapters(demoEnv);
    const eventType = await booking.upsertBoardEventType({
      title: "Board",
      slug: "board",
      lengthInMinutes: 60,
      hostUserIds: [1, 2],
    });
    expect(eventType.eventTypeId).toBe(DEMO_EVENT_TYPE_ID);
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
