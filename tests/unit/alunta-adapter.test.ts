import { describe, expect, it } from "vitest";
import { buildCheckoutSessionRequest, buildSubscriptionPriceRequest } from "@/lib/payments/alunta";

/**
 * Alunta-adapterens rene request-byggere (ADR 0032/0056) — testet mod spec-formen:
 * checkout-sessions kræver type/plan_id/external_customer_id; `PUT /subscriptions/{uuid}/price`
 * tager `price` (flat-rate, mindste valutaenhed).
 */
describe("buildCheckoutSessionRequest", () => {
  it("bygger subscription-session med plan og vores kunde-reference", () => {
    expect(
      buildCheckoutSessionRequest({ planId: "plan-1", appUrl: "https://app.example" }, { customerRef: "m-1" }),
    ).toEqual({
      type: "subscription",
      plan_id: "plan-1",
      external_customer_id: "m-1",
      success_url: "https://app.example/betaling",
      back_url: "https://app.example/betaling",
    });
  });

  it("udelader redirect-URL'er når app-URL ikke er sat", () => {
    const request = buildCheckoutSessionRequest({ planId: "plan-1", appUrl: null }, { customerRef: "m-1" });
    expect(request).not.toHaveProperty("success_url");
    expect(request).not.toHaveProperty("back_url");
  });
});

describe("buildSubscriptionPriceRequest — abonnementets pris i øre", () => {
  it("sender hele det tilbagevendende beløb som `price`, uden gættet effective_date", () => {
    const request = buildSubscriptionPriceRequest({ amountMinor: 12345 });
    expect(request).toEqual({ price: 12345 });
    // Default er "næste kommende periode"; en gættet dato ville give 422 (kun available_price_change_dates).
    expect(request).not.toHaveProperty("effective_date");
  });
});
