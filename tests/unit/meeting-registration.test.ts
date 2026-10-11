import { describe, expect, it } from "vitest";

import { canRegisterStatus } from "@/server/meetings/registration";

/**
 * Fund fra e2e (fase 6.1): en partner kunne registrere et møde ni dage ude i fremtiden som
 * «afholdt» og dermed få en honorarlinje for et møde der ikke var holdt. «Forsinket afbud» sker
 * derimod før mødet og skal altid kunne registreres.
 */
describe("canRegisterStatus", () => {
  const now = new Date("2026-10-11T08:00:00Z");

  it("afviser 'afholdt' og 'udeblivelse' før mødet er begyndt", () => {
    expect(canRegisterStatus("afholdt", "2026-10-20T10:00:00Z", now)).toBe(false);
    expect(canRegisterStatus("udeblivelse", "2026-10-11T08:00:01Z", now)).toBe(false);
  });

  it("tillader 'afholdt' og 'udeblivelse' fra starttidspunktet", () => {
    expect(canRegisterStatus("afholdt", "2026-10-11T08:00:00Z", now)).toBe(true);
    expect(canRegisterStatus("udeblivelse", "2026-09-22T10:00:00Z", now)).toBe(true);
  });

  it("tillader altid 'forsinket_afbud' — det sker før mødet", () => {
    expect(canRegisterStatus("forsinket_afbud", "2026-10-20T10:00:00Z", now)).toBe(true);
    expect(canRegisterStatus("forsinket_afbud", "2026-09-22T10:00:00Z", now)).toBe(true);
  });

  it("accepterer starttidspunktet som Date", () => {
    expect(canRegisterStatus("afholdt", new Date("2026-10-12T10:00:00Z"), now)).toBe(false);
  });
});
