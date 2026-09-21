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
