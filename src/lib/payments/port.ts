/** Betalingsfrekvenser: kort registreres ved booking, træk ved afholdelse. */
export type PaymentFrequencyWeeks = 4 | 8 | 12;

export interface CardRegistration {
  customerRef: string;
}

export interface ChargeRequest {
  customerRef: string;
  /** Beløb i mindste valutaenhed (øre). TODO(ejer): sats bindes af honorar/meeting-fee. */
  amountMinor: number;
  /** Fx "DKK". */
  currency: string;
  frequencyWeeks: PaymentFrequencyWeeks;
  description: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Betaling ind. Leverandør: Alunta (ADR 0023).
 * TODO(mads): Alunta/Supabase-dataflow (kortregistrering, varierende betalingsfrekvenser,
 * webhooks, signaturverifikation) + MobilePay-verifikation — dataflow-afsøgningen (§12 pkt. 10)
 * leverer adapteren (ADR 0029).
 *
 * Bevidst INGEN opsig/opgradér-operationer: med træk-pr-afholdelse (§4) findes intet
 * abonnement hos leverandøren — op/nedgradering og opsigelse er rene Supabase-operationer
 * på membership (ADR 0029 begrunder afvigelsen fra ADR 0023's oprindelige interfaceliste).
 */
export interface PaymentProvider {
  readonly name: string;
  /** Registrér kort ved booking (intet træk endnu). */
  registerCard(reg: CardRegistration): Promise<CheckoutSession>;
  /** Træk ved afholdelse af møde. */
  charge(req: ChargeRequest): Promise<{ id: string }>;
}
