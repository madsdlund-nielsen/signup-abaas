import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  getNotificationOverview,
  listNotificationChannels,
} from "@/server/notifications";

/**
 * Skærm-først (fase 4.5/4.6): oversigten læser kanaltilstanden gennem adapterne, så den
 * følger adapter-valget i stedet for at have sin egen mening om hvad der er konfigureret.
 */
describe("notifikationsoversigt — kanaltilstand gennem portene", () => {
  it("kalder en kanal uden adapter en stub — ikke 'klar'", () => {
    const channels = listNotificationChannels({});
    expect(channels.map((c) => c.state)).toEqual(["stub", "stub"]);
    expect(channels.every((c) => c.flagEnabled === false)).toBe(true);
  });

  it("skelner mellem 'flaget er slukket' og 'flaget er tændt, men nøglerne mangler'", () => {
    const [email, sms] = listNotificationChannels({ FLAG_EMAIL: "true" });
    expect(email?.flagEnabled).toBe(true);
    // Flaget alene sender ingenting: uden nøgler er adapteren stadig en stub.
    expect(email?.state).toBe("stub");
    expect(sms?.flagEnabled).toBe(false);
  });

  it("melder ikke at noget kan sendes, når ingen kanal er live", () => {
    expect(getNotificationOverview({}).anyChannelLive).toBe(false);
  });

  it("dækker fase 4's fire påkrævede beskeder", () => {
    expect(NOTIFICATION_TYPES.map((t) => t.key)).toEqual([
      "meeting-reminder",
      "meeting-changed",
      "rating-request",
      "payment-failed",
    ]);
  });

  it("gætter ikke et udsendelsestidspunkt der ikke er besluttet", () => {
    const byKey = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, t]));
    expect(byKey["meeting-reminder"]?.timing).toBeNull();
    expect(byKey["rating-request"]?.timing).toBeNull();
    // De to der følger direkte af en hændelse har et tidspunkt, fordi det ikke er et valg.
    expect(byKey["meeting-changed"]?.timing).toBeTruthy();
    expect(byKey["payment-failed"]?.timing).toBeTruthy();
  });

  it("sender kun SMS på påmindelse og rating, jf. den låste stak", () => {
    const smsTypes = NOTIFICATION_TYPES.filter((t) => t.channels.includes("sms")).map((t) => t.key);
    expect(smsTypes).toEqual(["meeting-reminder", "rating-request"]);
    // E-mail bærer alle fire — Resend er transaktionsmailen.
    expect(NOTIFICATION_TYPES.every((t) => t.channels.includes("email"))).toBe(true);
  });
});

/**
 * Kataloget som kontrakt mellem kode og skabeloner (fase 4.6, ADR 0057).
 */
describe("notifikationskataloget — variabler og tidsplan", () => {
  it("tidsplanen kræver en tidstekst, og de planlagte typer er ikke fastlagt endnu (TODO(ejer))", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (type.schedule !== null) expect(type.timing, type.key).not.toBeNull();
    }
    const scheduled = NOTIFICATION_TYPES.filter((t) => t.key === "meeting-reminder" || t.key === "rating-request");
    expect(scheduled.every((t) => t.timing === null && t.schedule === null)).toBe(true);
  });

  it("variabelnøgler er gyldige, unikke pr. type, og hver type har et link til platformen", () => {
    for (const type of NOTIFICATION_TYPES) {
      const keys = type.variables.map((v) => v.key);
      expect(new Set(keys).size, type.key).toBe(keys.length);
      for (const key of keys) expect(key, `${type.key}.${key}`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(keys, type.key).toContain("link");
    }
  });

  it("der er ingen skabelontekst i kataloget — kun nøgler og etiketter", () => {
    expect(JSON.stringify(NOTIFICATION_TYPES)).not.toMatch(/"subject"|"body"|Kære|Hej /i);
  });

  it("eksempelværdierne til preview er åbenlyst falske og dækker alle variabler", async () => {
    const { PREVIEW_EXAMPLES } = await import("@/server/notifications/examples");
    const keys = new Set(NOTIFICATION_TYPES.flatMap((t) => t.variables.map((v) => v.key)));
    for (const key of keys) {
      const example = PREVIEW_EXAMPLES[key];
      expect(example, key).toBeDefined();
      expect(example, key).toMatch(/\[DEMO\]|demo\.invalid/);
    }
  });
});

describe("kanaltilstand med demo (ADR 0041/0057)", () => {
  it("kalder en demo-kanal 'demo' — hverken 'live' eller 'stub' — og den tæller ikke som live", () => {
    const channels = listNotificationChannels({ FLAG_DEMO: "true" });
    expect(channels.map((c) => c.state)).toEqual(["demo", "demo"]);
    expect(getNotificationOverview({ FLAG_DEMO: "true" }).anyChannelLive).toBe(false);
  });

  it("kalder en kanal med flag og nøgler 'live'", () => {
    const [email] = listNotificationChannels({
      FLAG_EMAIL: "true",
      RESEND_API_KEY: "test",
      RESEND_FROM_ADDRESS: "x@example.invalid",
    });
    expect(email?.state).toBe("live");
  });
});
