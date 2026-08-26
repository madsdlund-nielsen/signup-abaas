import { describe, expect, it } from "vitest";
import { computeMeetingFee, factorFor, formatMinor } from "@/server/pricing/algorithm";
import type { FrequencyWeeks, PricingRuleInput } from "@/server/pricing/algorithm";

/**
 * Prisberegning (fase 3, ADR 0030). Algoritmen er DB-fri. Testværdierne er åbenlyst
 * syntetiske — de reelle satser er ejer-uafklarede og indtastes af admin i prod.
 */
function rule(overrides: Partial<PricingRuleInput> = {}): PricingRuleInput {
  return {
    id: "r1",
    version: 1,
    baseAmountMinor: 100,
    perPartnerAmountMinor: 10,
    factor4Weeks: 1,
    factor8Weeks: 0.5,
    factor12Weeks: 0.25,
    currency: "DKK",
    ...overrides,
  };
}

describe("computeMeetingFee — formlen (base + n × perPartner) × faktor", () => {
  it("beregner for alle kombinationer af 2-3 partnere × 4/8/12 uger", () => {
    // base 100 + 2×10 = 120; faktorer 1 / 0.5 / 0.25.
    expect(computeMeetingFee(rule(), 2, 4).amountMinor).toBe(120);
    expect(computeMeetingFee(rule(), 2, 8).amountMinor).toBe(60);
    expect(computeMeetingFee(rule(), 2, 12).amountMinor).toBe(30);
    // base 100 + 3×10 = 130.
    expect(computeMeetingFee(rule(), 3, 4).amountMinor).toBe(130);
    expect(computeMeetingFee(rule(), 3, 8).amountMinor).toBe(65);
    expect(computeMeetingFee(rule(), 3, 12).amountMinor).toBe(33); // 32.5 → afrundet
  });

  it("afrunder til nærmeste øre (aldrig brøkdele)", () => {
    const fee = computeMeetingFee(rule({ factor4Weeks: 1.111 }), 2, 4);
    expect(Number.isInteger(fee.amountMinor)).toBe(true);
    expect(fee.amountMinor).toBe(Math.round(120 * 1.111));
  });

  it("bærer versionsreferencen med til audit (payment_charge.pricing_rule_id)", () => {
    const fee = computeMeetingFee(rule({ id: "regel-x", version: 7 }), 2, 4);
    expect(fee.pricingRuleId).toBe("regel-x");
    expect(fee.pricingRuleVersion).toBe(7);
  });

  it("regnestykket er gennemsigtigt (breakdown summerer)", () => {
    const fee = computeMeetingFee(rule(), 3, 8);
    const b = fee.breakdown;
    expect(b.partnersAmountMinor).toBe(b.partnerCount * b.perPartnerAmountMinor);
    expect(b.subtotalMinor).toBe(b.baseAmountMinor + b.partnersAmountMinor);
    expect(fee.amountMinor).toBe(Math.round(b.subtotalMinor * b.factor));
  });

  it("NEGATIV: ugyldigt partnerantal kaster (hellere højlydt end forkert beløb)", () => {
    expect(() => computeMeetingFee(rule(), 0, 4)).toThrow(/partnerantal/);
    expect(() => computeMeetingFee(rule(), 2.5, 4)).toThrow(/partnerantal/);
  });

  it("NEGATIV: ugyldig frekvens kaster", () => {
    expect(() => computeMeetingFee(rule(), 2, 6 as FrequencyWeeks)).toThrow(/frekvens/i);
  });

  it("NEGATIV: faktor ≤ 0 kaster", () => {
    expect(() => computeMeetingFee(rule({ factor8Weeks: 0 }), 2, 8)).toThrow(/faktor/i);
  });
});

describe("factorFor + formatMinor", () => {
  it("vælger den rigtige faktor pr. frekvens", () => {
    expect(factorFor(rule(), 4)).toBe(1);
    expect(factorFor(rule(), 8)).toBe(0.5);
    expect(factorFor(rule(), 12)).toBe(0.25);
  });

  it("formaterer øre som DKK", () => {
    expect(formatMinor(12345, "DKK")).toMatch(/123,45/);
  });
});
