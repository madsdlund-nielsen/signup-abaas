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
 * Betaling ind. Leverandører: Stripe + MobilePay.
 * TODO(mads): Stripe/Supabase-dataflow (kortregistrering, varierende
 * betalingsfrekvenser, webhooks) + Alunta vs. Stripe Billing.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Registrér kort ved booking (intet træk endnu). */
  registerCard(reg: CardRegistration): Promise<CheckoutSession>;
  /** Træk ved afholdelse af møde. */
  charge(req: ChargeRequest): Promise<{ id: string }>;
}
