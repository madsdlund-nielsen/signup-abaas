/**
 * Alunta-adapter (Fase 3, ADR 0032 + 0056) — skrevet mod Aluntas OpenAPI-spec
 * (https://app.alunta.com/docs/v1/openapi.yaml). Rå fetch, Bearer-auth, ingen SDK —
 * samme mønster som Cal.com-adapteren. Alunta-typer må aldrig lække ud af denne fil.
 *
 * Modellen (ADR 0034 + 0056): et FAST ABONNEMENT pr. kunde.
 *   1. `registerCard` opretter en checkout-session (type subscription) mod en flat-rate-plan.
 *      Når kunden gennemfører, opretter Alunta abonnementet og `checkout.completed` melder
 *      kunde-uuid OG abonnements-uuid tilbage (webhooken kobler begge på medlemskabet).
 *   2. `upsertSubscription` sætter abonnementets pris til det beløb vores versionerede
 *      pricing_rule har regnet ud (`PUT /subscriptions/{uuid}/price`, flat-rate, beløb i øre).
 *      Vores pricing_rule forbliver den autoritative prisberegner — planen i Alunta bærer ingen
 *      prislogik, kun opkrævningen. Ændringen gælder fra Aluntas næste periode (spec'en:
 *      "By default the change takes effect from the next upcoming period") — ingen proratering.
 *   3. Alunta fakturerer og trækker selv; webhooks (invoice.paid / invoice.payment_failed)
 *      melder tilbage. Der er INTET synkront træk og ikke længere nogen usage-indberetning.
 *
 * ⚠ KADENCEN ER IKKE LEVERBAR HER (fundet ved gennemlæsning af spec'en, ADR 0056):
 *   Aluntas faktureringsintervaller er i MÅNEDER (1/3/4/6/12) — uger og dage findes ikke på
 *   hverken plan, abonnement eller checkout. ADR 0034 kræver hver 4. UGE (28 dage). Adapteren
 *   kan derfor ikke sætte `intervalDays` og forsøger ikke at approksimere det med et
 *   månedsinterval; den faktiske kadence hos Alunta bestemmes af planens renewal-interval,
 *   sat i Alunta-UI'et. Vores egen periodekæde (`payment_charge`, 28 dage) er uændret
 *   autoritativ for hvad der SKAL opkræves hvornår.
 *   TODO(mads): afklar med Alunta om en 28-dages kadence findes uden for API'et, eller vælg
 *   mellem (a) månedlig/4-måneders Alunta-kadence med ejerens accept, (b) engangsfakturaer
 *   pr. periode (`POST /invoices` med Idempotency-Key = payment_charge.id) — begge er
 *   forretningsvalg, ikke Claude Codes (docs/backlog.md B-35, ADR 0056).
 *
 * TODO(mads): verificér mod Alunta (live, test_mode) — `PUT /subscriptions/{uuid}/price` er
 *   læst i spec'en men aldrig kørt; planen skal være flat-rate (usage-/tier-planer afviser
 *   kaldet med 422), og planens valuta er den abonnementet bruger (`currency` sendes ikke).
 */

import type { CardRegistration, CheckoutSession, PaymentProvider, SubscriptionRequest } from "./port";

export interface AluntaConfig {
  apiKey: string;
  /** Den flat-rate Alunta-plan checkout-sessions oprettes mod (opsættes i Alunta-UI). */
  planId: string;
  /** Default https://app.alunta.com/api/v1 (spec'ens server-URL). */
  apiUrl: string;
  /** Absolut base-URL for appen — bruges til success/back-URL'er på checkout-sessionen. */
  appUrl: string | null;
}

export class AluntaError extends Error {
  constructor(operation: string, status: number, body: string) {
    super(`Alunta ${operation} fejlede (HTTP ${status}): ${body.slice(0, 300)}`);
    this.name = "AluntaError";
  }
}

/** Abonnementet findes ikke hos Alunta endnu — det oprettes af checkout, ikke af os. */
export class AluntaSubscriptionNotLinkedError extends Error {
  constructor(membershipId: string) {
    super(
      `Alunta-abonnementet for medlemskab ${membershipId} er ikke koblet endnu ` +
        "(checkout.completed har ikke meldt en subscription-uuid tilbage).",
    );
    this.name = "AluntaSubscriptionNotLinkedError";
  }
}

/** Ren request-bygger (unit-testbar): POST /checkout-sessions, type subscription. */
export function buildCheckoutSessionRequest(
  config: Pick<AluntaConfig, "planId" | "appUrl">,
  reg: CardRegistration,
): Record<string, unknown> {
  return {
    type: "subscription",
    plan_id: config.planId,
    external_customer_id: reg.customerRef,
    ...(config.appUrl
      ? { success_url: `${config.appUrl}/betaling`, back_url: `${config.appUrl}/betaling` }
      : {}),
  };
}

/**
 * Ren request-bygger (unit-testbar): PUT /subscriptions/{uuid}/price. Flat-rate-abonnementer
 * tager `price` (hele det tilbagevendende beløb i mindste valutaenhed). `effective_date`
 * udelades bevidst: default er "næste kommende periode", og kun datoer fra abonnementets
 * `available_price_change_dates` er gyldige — en gættet dato ville give 422.
 */
export function buildSubscriptionPriceRequest(req: Pick<SubscriptionRequest, "amountMinor">): Record<string, unknown> {
  return { price: req.amountMinor };
}

export class AluntaPaymentProvider implements PaymentProvider {
  readonly name = "alunta";

  constructor(private readonly config: AluntaConfig) {}

  private async request(operation: string, method: "POST" | "PUT", path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new AluntaError(operation, response.status, await response.text());
    }
    return response.json();
  }

  async registerCard(reg: CardRegistration): Promise<CheckoutSession> {
    const payload = (await this.request(
      "registerCard",
      "POST",
      "/checkout-sessions",
      buildCheckoutSessionRequest(this.config, reg),
    )) as { data?: { uuid?: string; url?: string }; uuid?: string; url?: string };
    const data = payload.data ?? payload;
    if (!data.url) {
      throw new AluntaError("registerCard", 200, `uventet svarform: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { id: String(data.uuid ?? data.url), url: data.url };
  }

  async upsertSubscription(req: SubscriptionRequest): Promise<{ id: string }> {
    // Abonnementet oprettes af checkouten (checkout.completed melder uuid'et). Uden det er der
    // intet at opdatere — fejl højlydt frem for at oprette et andet abonnement ved siden af.
    if (!req.subscriptionRef) throw new AluntaSubscriptionNotLinkedError(req.membershipId);

    // PUT med samme pris er idempotent: gentagelsen ændrer ingenting, og tidligere
    // planlagte prisændringer erstattes af den nyeste.
    await this.request(
      "upsertSubscription",
      "PUT",
      `/subscriptions/${encodeURIComponent(req.subscriptionRef)}/price`,
      buildSubscriptionPriceRequest(req),
    );
    return { id: req.subscriptionRef };
  }
}
