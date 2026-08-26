/**
 * Alunta-adapter (Fase 3, ADR 0032) — skrevet mod den VERIFICEREDE OpenAPI-spec
 * (https://app.alunta.com/docs/v1/openapi.yaml). Rå fetch, Bearer-auth, ingen SDK —
 * samme mønster som Cal.com-adapteren. Alunta-typer må aldrig lække ud af denne fil.
 *
 * Modellen (ADR 0032): checkout-session (type subscription) registrerer kortet via
 * leverandørens hosted side; forbrug indberettes som usage-events i ØRE mod parameteren
 * `meeting_fee_oere` (Alunta-planens enhedspris = 1 øre), så vores versionerede
 * pricing_rule forbliver den autoritative prisberegner. Alunta fakturerer og trækker
 * automatisk pr. periode; webhooks melder tilbage.
 */

import type { CardRegistration, CheckoutSession, PaymentProvider, UsageChargeRequest } from "./port";

/** Usage-parameterens slug i Alunta (auto-oprettes ved første indberetning, kind counter). */
export const USAGE_PARAMETER = "meeting_fee_oere";

export interface AluntaConfig {
  apiKey: string;
  /** Den usage-baserede Alunta-plan checkout-sessions oprettes mod (opsættes i Alunta-UI). */
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

/** Ren request-bygger (unit-testbar): POST /customers/{uuid}/usage-events. */
export function buildUsageEventRequest(req: UsageChargeRequest): Record<string, unknown> {
  return {
    parameter: USAGE_PARAMETER,
    quantity: req.amountMinor,
    kind: "counter",
    idempotency_key: req.idempotencyKey,
  };
}

export class AluntaPaymentProvider implements PaymentProvider {
  readonly name = "alunta";

  constructor(private readonly config: AluntaConfig) {}

  private async request(operation: string, path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method: "POST",
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
      "/checkout-sessions",
      buildCheckoutSessionRequest(this.config, reg),
    )) as { data?: { uuid?: string; url?: string }; uuid?: string; url?: string };
    const data = payload.data ?? payload;
    if (!data.url) {
      throw new AluntaError("registerCard", 200, `uventet svarform: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { id: String(data.uuid ?? data.url), url: data.url };
  }

  async reportUsageCharge(req: UsageChargeRequest): Promise<{ id: string }> {
    // 200 = idempotent gentagelse (nøglen kendt), 201 = ny — begge er succes (spec'en).
    const payload = (await this.request(
      "reportUsageCharge",
      `/customers/${req.customerRef}/usage-events`,
      buildUsageEventRequest(req),
    )) as { data?: { uuid?: string }; uuid?: string };
    const uuid = payload.data?.uuid ?? payload.uuid;
    return { id: uuid ? String(uuid) : req.idempotencyKey };
  }
}
