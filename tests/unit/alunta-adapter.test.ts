import { describe, expect, it } from "vitest";
import {
  buildCheckoutSessionRequest,
  buildUsageEventRequest,
  USAGE_PARAMETER,
} from "@/lib/payments/alunta";

/**
 * Alunta-adapterens rene request-byggere (ADR 0032) — testet mod den verificerede spec-form:
 * checkout-sessions kræver type/plan_id/external_customer_id; usage-events kræver
 * parameter/quantity og bærer idempotency_key.
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

describe("buildUsageEventRequest — meeting-fee som forbrug i øre", () => {
  it("indberetter beløbet som counter-delta med idempotensnøgle", () => {
    expect(
      buildUsageEventRequest({
        customerRef: "cust-1",
        amountMinor: 12345,
        idempotencyKey: "charge-1",
        description: "møde",
      }),
    ).toEqual({
      parameter: USAGE_PARAMETER,
      quantity: 12345,
      kind: "counter",
      idempotency_key: "charge-1",
    });
  });
});
