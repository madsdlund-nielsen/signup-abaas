/**
 * Prisberegning (Fase 3, ADR 0028). Byggespec §4/§5.9: meeting-fee skalerer med
 * boardstørrelse og frekvens. Formlen er MEKANIK — værdierne kommer fra den aktive
 * prisregel som admin har indtastet. Der findes ingen tal her (stub-politik).
 *
 * BEVIDST REN: ingen Supabase-, env- eller React-afhængigheder — unit-testbar uden DB,
 * og kan køre client-side til den live prisberegner (§5.9).
 *
 *   meeting_fee = round((base + antal_partnere × per_partner) × faktor_for_frekvens)
 *
 * TODO(ejer): moms (§12 pkt. 14) — beløb er rå øre uden momslogik.
 */

export type FrequencyWeeks = 4 | 8 | 12;

export interface PricingRuleInput {
  id: string;
  version: number;
  baseAmountMinor: number;
  perPartnerAmountMinor: number;
  factor4Weeks: number;
  factor8Weeks: number;
  factor12Weeks: number;
  currency: string;
}

export interface MeetingFeeBreakdown {
  /** Grundpris pr. møde (øre). */
  baseAmountMinor: number;
  partnerCount: number;
  perPartnerAmountMinor: number;
  /** partnerCount × perPartnerAmountMinor. */
  partnersAmountMinor: number;
  /** Den anvendte frekvensfaktor. */
  frequencyWeeks: FrequencyWeeks;
  factor: number;
  /** base + partners, FØR faktor. */
  subtotalMinor: number;
}

export interface MeetingFee {
  /** Endeligt meeting-fee i øre, afrundet. */
  amountMinor: number;
  currency: string;
  /** Reglens version — audit-reference til payment_charge. */
  pricingRuleId: string;
  pricingRuleVersion: number;
  breakdown: MeetingFeeBreakdown;
}

export function factorFor(rule: PricingRuleInput, frequencyWeeks: FrequencyWeeks): number {
  switch (frequencyWeeks) {
    case 4:
      return rule.factor4Weeks;
    case 8:
      return rule.factor8Weeks;
    case 12:
      return rule.factor12Weeks;
  }
}

/** Beregn meeting-fee. Kaster ved ugyldigt input — hellere højlydt end et forkert beløb. */
export function computeMeetingFee(
  rule: PricingRuleInput,
  partnerCount: number,
  frequencyWeeks: FrequencyWeeks,
): MeetingFee {
  if (!Number.isInteger(partnerCount) || partnerCount < 1) {
    throw new Error(`Ugyldigt partnerantal: ${partnerCount}.`);
  }
  if (frequencyWeeks !== 4 && frequencyWeeks !== 8 && frequencyWeeks !== 12) {
    throw new Error(`Ugyldig frekvens: ${String(frequencyWeeks)} uger.`);
  }

  const factor = factorFor(rule, frequencyWeeks);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Ugyldig frekvensfaktor for ${frequencyWeeks} uger.`);
  }

  const partnersAmountMinor = partnerCount * rule.perPartnerAmountMinor;
  const subtotalMinor = rule.baseAmountMinor + partnersAmountMinor;
  const amountMinor = Math.round(subtotalMinor * factor);

  return {
    amountMinor,
    currency: rule.currency,
    pricingRuleId: rule.id,
    pricingRuleVersion: rule.version,
    breakdown: {
      baseAmountMinor: rule.baseAmountMinor,
      partnerCount,
      perPartnerAmountMinor: rule.perPartnerAmountMinor,
      partnersAmountMinor,
      frequencyWeeks,
      factor,
      subtotalMinor,
    },
  };
}

/** Formatér øre som danske kroner til visning (da-DK, to decimaler). */
export function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("da-DK", { style: "currency", currency }).format(amountMinor / 100);
}
