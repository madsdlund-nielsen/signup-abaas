/** Mødefrekvens (domænet): hvor ofte boardet mødes — 4 / 8 / 12 uger. Det er en akse i PRISEN,
 *  ikke i opkrævningen: abonnementet forfalder altid hver 4. uge (ADR 0034). */
export type PaymentFrequencyWeeks = 4 | 8 | 12;

export interface CardRegistration {
  /** Vores kunde-reference (membership-id) — sendes som external_customer_id og kommer
   *  retur i checkout.completed, så webhooken kan koble Aluntas customer-uuid på. */
  customerRef: string;
}

/**
 * Sæt kundens fast-pris-abonnement (B-19, ADR 0034 + 0056): beløbet pr. faktureringsperiode og
 * kadencen. Vores versionerede `pricing_rule` er stadig den autoritative prisberegner —
 * leverandøren bærer kun beløbet og opkrævningen, ingen prislogik.
 *
 * Kaldet er IDEMPOTENT og kan gentages med samme indhold: det opdaterer prisen på det
 * eksisterende abonnement. Ændringer gælder fra leverandørens NÆSTE periode (ingen
 * proratering — det er ikke besluttet, TODO(ejer)).
 */
export interface SubscriptionRequest {
  /** Vores medlemskabs-id — leverandør-neutralt opslag/audit. */
  membershipId: string;
  /** Leverandørens customer-uuid (fra checkout.completed → membership.provider_customer_ref). */
  customerRef: string;
  /** Leverandørens eksisterende abonnement (membership.provider_subscription_ref), hvis kendt. */
  subscriptionRef: string | null;
  /** Beløb pr. periode i mindste valutaenhed (øre), beregnet af den aktive prisregel. */
  amountMinor: number;
  currency: string;
  /**
   * Kadencen vi forventer: 28 dage (hver 4. uge, ADR 0034). En adapter der ikke kan levere den
   * eksakt må ikke skjule afvigelsen: den dokumenterer den og markerer den med en TODO. Alunta
   * kan det ikke (intervaller i måneder) — se alunta.ts og docs/backlog.md B-35.
   */
  intervalDays: number;
  /** Første dag i abonnementet (membership.billing_anchor), "YYYY-MM-DD". */
  startsOn: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Betaling ind. Leverandør: Alunta (ADR 0023; dataflow verificeret i ADR 0032 og udvidet i
 * ADR 0056). Porten har to operationer: registrér kort (hosted checkout, der også opretter
 * abonnementet hos leverandøren) og sæt abonnementets pris. Der er bevidst INGEN synkron
 * charge — leverandøren fakturerer og trækker selv; webhooken er autoritativ for gennemført/fejlet.
 * Opsigelse og op-/nedgradering er membership-operationer i Supabase (ADR 0030/0031).
 */
export interface PaymentProvider {
  readonly name: string;
  /** Start kortregistrering: opret hosted checkout-session og returnér URL'en. */
  registerCard(reg: CardRegistration): Promise<CheckoutSession>;
  /** Sæt abonnementets pris/kadence (idempotent). Returnerer leverandørens abonnements-reference. */
  upsertSubscription(req: SubscriptionRequest): Promise<{ id: string }>;
}
