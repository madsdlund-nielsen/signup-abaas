import { describe, expect, it } from "vitest";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  buildConsentCookie,
  defaultConsent,
  hasConsent,
  parseConsent,
  readConsentChoice,
  serializeConsent,
} from "@/server/consent";

describe("samtykke-model", () => {
  it("standard: kun nødvendig er til", () => {
    const c = defaultConsent();
    expect(hasConsent(c, "necessary")).toBe(true);
    expect(hasConsent(c, "functional")).toBe(false);
    expect(hasConsent(c, "analytics")).toBe(false);
  });

  it("manglende/ugyldig lagret værdi → standard (opt-in)", () => {
    expect(parseConsent(undefined)).toEqual(defaultConsent());
    expect(parseConsent("ikke-json")).toEqual(defaultConsent());
  });

  it("nødvendig kan ikke fravælges via lagret værdi", () => {
    const c = parseConsent(JSON.stringify({ functional: false, analytics: false }));
    expect(hasConsent(c, "necessary")).toBe(true);
  });

  it("round-trip bevarer valgbare kategorier", () => {
    const chosen = { necessary: true as const, functional: true, analytics: true };
    expect(parseConsent(serializeConsent(chosen))).toEqual(chosen);
  });
});

describe("samtykke-cookien (ADR 0072)", () => {
  const nej = { necessary: true as const, functional: false, analytics: false };
  const ja = { necessary: true as const, functional: false, analytics: true };

  it("«ikke valgt» kan skelnes fra «kun nødvendige» (parseConsent kan ikke)", () => {
    expect(readConsentChoice(undefined)).toBeNull();
    expect(readConsentChoice("")).toBeNull();
    expect(readConsentChoice("ikke-json")).toBeNull();
    expect(readConsentChoice("null")).toBeNull();
    expect(readConsentChoice('"streng"')).toBeNull();
    expect(readConsentChoice("{}")).toBeNull();
    expect(readConsentChoice(JSON.stringify({ analytics: "true", functional: false }))).toBeNull();
    expect(readConsentChoice(serializeConsent(nej))).toEqual(nej);
  });

  it("læser både rå JSON og den URL-kodede cookieværdi", () => {
    expect(readConsentChoice(serializeConsent(ja))).toEqual(ja);
    expect(readConsentChoice(encodeURIComponent(serializeConsent(ja)))).toEqual(ja);
    expect(readConsentChoice("%E0%A4%A")).toBeNull(); // ugyldig kodning kaster ikke
  });

  it("nødvendig kan ikke fravælges, uanset hvad cookien siger", () => {
    expect(readConsentChoice('{"necessary":false,"functional":false,"analytics":true}')?.necessary).toBe(true);
  });

  it("bygger en førstepartscookie på 12 måneder, Path=/, SameSite=Lax — Secure kun over https", () => {
    const http = buildConsentCookie(ja, { secure: false });
    const https = buildConsentCookie(ja, { secure: true });
    expect(http.startsWith(`${CONSENT_COOKIE}=`)).toBe(true);
    expect(http).toContain(`Max-Age=${CONSENT_MAX_AGE_SECONDS}`);
    expect(CONSENT_MAX_AGE_SECONDS).toBe(31536000);
    expect(http).toContain("Path=/");
    expect(http).toContain("SameSite=Lax");
    expect(http).not.toContain("Secure");
    expect(https).toContain("; Secure");
  });

  it("cookieværdien kan læses tilbage (round-trip gennem cookie-strengen)", () => {
    const value = buildConsentCookie(ja, { secure: false }).split(";")[0]!.slice(CONSENT_COOKIE.length + 1);
    expect(readConsentChoice(value)).toEqual(ja);
    expect(value).not.toMatch(/[\s;,"]/); // intet der bryder en cookieværdi
  });
});
