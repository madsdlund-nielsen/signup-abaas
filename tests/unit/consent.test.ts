import { describe, expect, it } from "vitest";
import {
  defaultConsent,
  hasConsent,
  parseConsent,
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
