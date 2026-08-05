/** Betalingsfrekvenser (mødekadence i domænet): kort registreres ved booking, forbrug
 *  indberettes ved afholdelse. Faktureringskadencen hos leverandøren er en anden akse
 *  (Alunta fakturerer i måneds-intervaller — ADR 0030). */
export type PaymentFrequencyWeeks = 4 | 8 | 12;

export interface CardRegistration {
  /** Vores kunde-reference (membership-id) — sendes som external_customer_id og kommer
   *  retur i checkout.completed, så webhooken kan koble Aluntas customer-uuid på. */
  customerRef: string;
}

/**
 * Indberet et afholdt mødes meeting-fee som forbrug til opkrævning. Alunta har INTET
 * synkront kort-træk (verificeret, ADR 0030): trækket udløses her og opkræves automatisk
 * på leverandørens næste periodefaktura. Webhooken er autoritativ for gennemført/fejlet.
 */
export interface UsageChargeRequest {
  /** Leverandørens customer-uuid (fra checkout.completed → membership.provider_customer_ref). */
  customerRef: string;
  /** Beløb i mindste valutaenhed (øre). TODO(ejer): sats bindes af honorar/meeting-fee. */
  amountMinor: number;
  /** Idempotensnøgle (payment_charge.id) — leverandøren dedupliker i ~30 dage. */
  idempotencyKey: string;
  description: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Betaling ind. Leverandør: Alunta (ADR 0023; dataflow verificeret i ADR 0030).
 *
 * Bevidst INGEN opsig/opgradér- eller synkron charge-operation: med træk-pr-afholdelse
 * findes intet abonnement at opdatere hos leverandøren ud over forbruget, og Aluntas
 * /payments-API er read-only. Op-/nedgradering og opsigelse er membership-operationer
 * i Supabase (ADR 0028/0029).
 */
export interface PaymentProvider {
  readonly name: string;
  /** Start kortregistrering: opret hosted checkout-session og returnér URL'en. */
  registerCard(reg: CardRegistration): Promise<CheckoutSession>;
  /** Indberet meeting-fee som forbrug (idempotent hos leverandøren). Returnerer reference. */
  reportUsageCharge(req: UsageChargeRequest): Promise<{ id: string }>;
}
