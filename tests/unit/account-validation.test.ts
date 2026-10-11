import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  DISPLAY_NAME_MAX,
  E164_PATTERN,
  TIME_ZONE_OPTIONS,
  isValidTimeZone,
  normaliseDisplayName,
  normalisePhone,
  parseProfileInput,
  smsConsentStamp,
  timeZoneChoices,
  type ValidProfile,
} from "@/server/account/validation";

/**
 * Kontoprofilens rene regler (skive K, ADR 0061). Alle numre er åbenlyst opfundne
 * (00 00 00 00-agtige), alle navne `[DEMO]`.
 */

function phone(raw: string): string | null {
  const result = normalisePhone(raw);
  if (!result.ok) throw new Error(`forventede et gyldigt nummer: ${result.error}`);
  return result.phone;
}

function phoneError(raw: string): string {
  const result = normalisePhone(raw);
  if (result.ok) throw new Error(`forventede en fejl, fik ${result.phone}`);
  return result.error;
}

describe("normalisePhone — dansk inputhjælp til E.164", () => {
  it("otte cifre er et dansk nummer: +45 sættes foran, mellemrum og tegnsætning ignoreres", () => {
    expect(phone("20000000")).toBe("+4520000000");
    expect(phone("20 00 00 00")).toBe("+4520000000");
    expect(phone("20-00-00-00")).toBe("+4520000000");
    expect(phone("(20) 00.00.00")).toBe("+4520000000");
    expect(phone("  20000000  ")).toBe("+4520000000");
  });

  it("et nummer med + er allerede internationalt og beholdes", () => {
    expect(phone("+45 20 00 00 00")).toBe("+4520000000");
    expect(phone("+46 70 000 00 00")).toBe("+46700000000");
    expect(phone("+1 (555) 000-0000")).toBe("+15550000000");
  });

  it("00 foran landekoden er et +", () => {
    expect(phone("0045 20 00 00 00")).toBe("+4520000000");
    expect(phone("0046700000000")).toBe("+46700000000");
  });

  it("tomt input betyder 'intet nummer' (null)", () => {
    expect(phone("")).toBeNull();
    expect(phone("   ")).toBeNull();
  });

  it("resultatet matcher altid E.164-mønstret som databasens constraint bruger", () => {
    for (const raw of ["20000000", "+4520000000", "004520000000", "+15550000000"]) {
      expect(phone(raw)).toMatch(E164_PATTERN);
    }
  });

  it("afviser et otte-cifret tal der ikke kan være dansk (starter med 0 eller 1)", () => {
    expect(phoneError("12345678")).toMatch(/starter med 2-9/);
    expect(phoneError("02345678")).toMatch(/starter med 2-9/);
  });

  it("gætter ikke på flertydige tal: uden + og ikke otte cifre afvises med en vejledning", () => {
    expect(phoneError("4520000000")).toMatch(/hvilket land/);
    expect(phoneError("2000")).toMatch(/hvilket land/);
    expect(phoneError("200000000")).toMatch(/hvilket land/);
  });

  it("afviser bogstaver og et plustegn midt i nummeret", () => {
    expect(phoneError("20 00 00 ab")).toMatch(/kun indeholde cifre/);
    expect(phoneError("20+00000000")).toMatch(/Plustegnet må kun stå forrest/);
    expect(phoneError("+45+20000000")).toMatch(/Plustegnet må kun stå forrest/);
  });

  it("afviser internationale numre uden for E.164 (for kort, for langt, landekode 0)", () => {
    expect(phoneError("+45123")).toMatch(/gyldigt internationalt/);
    expect(phoneError("+1234567890123456")).toMatch(/gyldigt internationalt/);
    expect(phoneError("+0123456789")).toMatch(/gyldigt internationalt/);
    expect(phoneError("+")).toMatch(/gyldigt internationalt/);
  });
});

describe("normaliseDisplayName", () => {
  it("trimmer og samler mellemrum; tomt er 'ikke angivet'", () => {
    expect(normaliseDisplayName("  [DEMO]   Eva \n Ejer ")).toBe("[DEMO] Eva Ejer");
    expect(normaliseDisplayName("")).toBeNull();
    expect(normaliseDisplayName(" \t\n ")).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("accepterer IANA-navne og UTC", () => {
    for (const zone of ["Europe/Copenhagen", "America/Nuuk", "Atlantic/Faroe", "America/Argentina/Buenos_Aires", "UTC"]) {
      expect(isValidTimeZone(zone), zone).toBe(true);
    }
  });

  it("afviser ukendte navne, forkert form og tom streng", () => {
    for (const zone of ["Europe/Atlantis", "Copenhagen", "", "europe", "+01:00", "Europe/", "Europe/Copenhagen; drop", " Europe/Copenhagen"]) {
      expect(isValidTimeZone(zone), JSON.stringify(zone)).toBe(false);
    }
  });

  it("alle valgmulighederne i formularen er gyldige zoner, og standarden er blandt dem", () => {
    for (const option of TIME_ZONE_OPTIONS) expect(isValidTimeZone(option.value), option.value).toBe(true);
    expect(TIME_ZONE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_TIME_ZONE);
    expect(new Set(TIME_ZONE_OPTIONS.map((o) => o.value)).size).toBe(TIME_ZONE_OPTIONS.length);
  });
});

describe("timeZoneChoices", () => {
  it("er listen uændret når kontoens zone står i den", () => {
    expect(timeZoneChoices("Europe/Berlin")).toBe(TIME_ZONE_OPTIONS);
  });

  it("tilføjer kontoens egen zone forrest, så et gemt valg aldrig forsvinder fra vælgeren", () => {
    const choices = timeZoneChoices("Asia/Tokyo");
    expect(choices[0]).toEqual({ value: "Asia/Tokyo", label: "Asia/Tokyo" });
    expect(choices).toHaveLength(TIME_ZONE_OPTIONS.length + 1);
  });
});

const BASE = { displayName: "[DEMO] Eva Ejer", phone: "20 00 00 00", timeZone: "Europe/Copenhagen", smsOptIn: true };

describe("parseProfileInput", () => {
  it("normaliserer alle felter", () => {
    const result = parseProfileInput({ ...BASE, displayName: "  [DEMO]  Eva Ejer " });
    expect(result).toEqual({
      ok: true,
      profile: { displayName: "[DEMO] Eva Ejer", phone: "+4520000000", timeZone: "Europe/Copenhagen", smsOptIn: true },
    });
  });

  it("navn og telefon er valgfrie: tomme felter bliver null", () => {
    expect(parseProfileInput({ displayName: "", phone: "", timeZone: "UTC", smsOptIn: false })).toEqual({
      ok: true,
      profile: { displayName: null, phone: null, timeZone: "UTC", smsOptIn: false },
    });
  });

  it("afviser et for langt navn og styretegn med danske fejl", () => {
    const tooLong = parseProfileInput({ ...BASE, displayName: "x".repeat(DISPLAY_NAME_MAX + 1) });
    expect(tooLong).toMatchObject({ ok: false, error: expect.stringContaining(String(DISPLAY_NAME_MAX)) });
    expect(parseProfileInput({ ...BASE, displayName: "x".repeat(DISPLAY_NAME_MAX) }).ok).toBe(true);
    expect(parseProfileInput({ ...BASE, displayName: "Eva\u0007Ejer" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/styretegn/),
    });
  });

  it("afviser en ugyldig tidszone", () => {
    expect(parseProfileInput({ ...BASE, timeZone: "Europe/Atlantis" })).toEqual({
      ok: false,
      error: "Vælg en gyldig tidszone.",
    });
    expect(parseProfileInput({ ...BASE, timeZone: "" }).ok).toBe(false);
  });

  it("NEGATIV: SMS-samtykke uden telefonnummer er en fejl — ikke et stille nej", () => {
    expect(parseProfileInput({ ...BASE, phone: "" })).toEqual({
      ok: false,
      error: "Du har sagt ja til SMS, men ikke angivet et telefonnummer.",
    });
  });

  it("et gemt nummer uden samtykke er lovligt (nummeret bruges bare ikke)", () => {
    expect(parseProfileInput({ ...BASE, smsOptIn: false })).toMatchObject({
      ok: true,
      profile: { phone: "+4520000000", smsOptIn: false },
    });
  });

  it("telefonfejlen fra normalisePhone kommer igennem", () => {
    expect(parseProfileInput({ ...BASE, phone: "12345678" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/starter med 2-9/),
    });
  });
});

describe("smsConsentStamp — samtykket gælder ét nummer", () => {
  const NOW = new Date("2026-10-10T12:00:00.000Z");
  const OLD = "2026-09-01T08:00:00.000Z";
  const profile = (over: Partial<ValidProfile> = {}): ValidProfile => ({
    displayName: null,
    phone: "+4520000000",
    timeZone: "Europe/Copenhagen",
    smsOptIn: true,
    ...over,
  });

  it("ikke afkrydset → ingen tidsstempel (aldrig givet eller tilbagekaldt)", () => {
    expect(smsConsentStamp(profile({ smsOptIn: false }), null, NOW)).toBeNull();
    expect(
      smsConsentStamp(profile({ smsOptIn: false }), { phone: "+4520000000", smsOptIn: true, smsOptInAt: OLD }, NOW),
    ).toBeNull();
  });

  it("nyt samtykke → nu", () => {
    expect(smsConsentStamp(profile(), null, NOW)).toBe(NOW.toISOString());
    expect(
      smsConsentStamp(profile(), { phone: "+4520000000", smsOptIn: false, smsOptInAt: null }, NOW),
    ).toBe(NOW.toISOString());
  });

  it("uændret samtykke på samme nummer bevarer det oprindelige tidspunkt (et nyt navn fornyer ikke samtykket)", () => {
    expect(
      smsConsentStamp(profile(), { phone: "+4520000000", smsOptIn: true, smsOptInAt: OLD }, NOW),
    ).toBe(OLD);
  });

  it("et ændret nummer er et nyt samtykke → nu", () => {
    expect(
      smsConsentStamp(profile({ phone: "+4530000000" }), { phone: "+4520000000", smsOptIn: true, smsOptInAt: OLD }, NOW),
    ).toBe(NOW.toISOString());
  });
});
