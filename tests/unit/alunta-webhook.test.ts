import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEventId,
  mapAluntaEvent,
  parseAluntaEvent,
  primaryUuid,
  verifyAluntaSignature,
  type AluntaWebhookPayload,
} from "@/server/charges/webhook";

const SECRET = "alunta-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function payload(overrides: Partial<AluntaWebhookPayload> = {}): AluntaWebhookPayload {
  return {
    event: "invoice.paid",
    team_id: 123,
    timestamp: "2026-08-04T10:30:00Z",
    data: {
      invoice: { uuid: "inv-1" },
      customer: { uuid: "cust-1" },
    },
    ...overrides,
  };
}

describe("alunta-webhook-signatur (VERIFICERET form: Signature-header, HMAC-SHA256 hex over rå body)", () => {
  it("gyldig signatur verificerer; forkert secret/body/manglende afvises", () => {
    const body = JSON.stringify(payload());
    expect(verifyAluntaSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyAluntaSignature(body, sign(body, "andet"), SECRET)).toBe(false);
    expect(verifyAluntaSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyAluntaSignature(body, null, SECRET)).toBe(false);
  });
});

describe("parseAluntaEvent — spec'ens WebhookPayload (event/team_id/timestamp/data)", () => {
  it("accepterer alle kendte event-typer", () => {
    for (const event of [
      "checkout.completed",
      "invoice.created",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.refunded",
      "subscription.payment_failed",
      "subscription.cancelled",
      "subscription.ended",
      "customer.usage_recorded",
    ] as const) {
      expect(parseAluntaEvent(payload({ event }))).not.toBeNull();
    }
  });

  it("NEGATIV: ukendt event, manglende timestamp/data eller ikke-objekt → null", () => {
    expect(parseAluntaEvent({ ...payload(), event: "refund.oprettet" })).toBeNull();
    expect(parseAluntaEvent({ ...payload(), timestamp: "" })).toBeNull();
    expect(parseAluntaEvent({ ...payload(), data: undefined })).toBeNull();
    expect(parseAluntaEvent(null)).toBeNull();
    expect(parseAluntaEvent("streng")).toBeNull();
  });
});

describe("afledt idempotensnøgle (payloaden har INTET stabilt event-id — spec-verificeret)", () => {
  it("genleverance = samme nøgle; ny hændelse (nyt timestamp) = ny nøgle", () => {
    expect(buildEventId(payload())).toBe(buildEventId(payload()));
    expect(buildEventId(payload({ timestamp: "2026-08-04T11:00:00Z" }))).not.toBe(
      buildEventId(payload()),
    );
  });

  it("primær uuid følger event-typen (invoice/subscription/customer)", () => {
    expect(primaryUuid(payload())).toBe("inv-1");
    expect(
      primaryUuid(payload({ event: "subscription.cancelled", data: { subscription: { uuid: "sub-1" } } })),
    ).toBe("sub-1");
    expect(
      primaryUuid(payload({ event: "checkout.completed", data: { customer: { uuid: "cust-1" } } })),
    ).toBe("cust-1");
  });
});

describe("mapAluntaEvent — webhooks opdaterer status, opretter aldrig", () => {
  it("checkout.completed (subscription) kobler membership ↔ Alunta-kunde", () => {
    expect(
      mapAluntaEvent(
        payload({
          event: "checkout.completed",
          data: { type: "subscription", external_customer_id: "m-1", customer: { uuid: "cust-1" } },
        }),
      ),
    ).toEqual({ kind: "card_registered", externalCustomerId: "m-1", aluntaCustomerUuid: "cust-1" });
  });

  it("NEGATIV: checkout.completed for one_off_invoice eller uden referencer ignoreres", () => {
    expect(
      mapAluntaEvent(
        payload({ event: "checkout.completed", data: { type: "one_off_invoice", customer: { uuid: "c" } } }),
      ).kind,
    ).toBe("ignore");
    expect(
      mapAluntaEvent(payload({ event: "checkout.completed", data: { customer: { uuid: "c" } } })).kind,
    ).toBe("ignore");
  });

  it("invoice.paid → gennemført for membershipets rapporterede forbrug (periode-aggregat)", () => {
    expect(mapAluntaEvent(payload())).toEqual({
      kind: "invoice_paid",
      aluntaCustomerUuid: "cust-1",
      invoiceUuid: "inv-1",
    });
  });

  it("invoice.payment_failed → fejlet med årsag (objekt- eller strengform)", () => {
    expect(
      mapAluntaEvent(
        payload({
          event: "invoice.payment_failed",
          data: { invoice: { uuid: "inv-1" }, customer: { uuid: "cust-1" }, error: { message: "Kort afvist" } },
        }),
      ),
    ).toEqual({
      kind: "invoice_failed",
      aluntaCustomerUuid: "cust-1",
      invoiceUuid: "inv-1",
      failureReason: "Kort afvist",
    });
  });

  it("subscription.cancelled/ended → membership opsagt", () => {
    for (const event of ["subscription.cancelled", "subscription.ended"] as const) {
      expect(
        mapAluntaEvent(payload({ event, data: { customer: { uuid: "cust-1" }, subscription: { uuid: "s" } } })),
      ).toEqual({ kind: "membership_cancelled", aluntaCustomerUuid: "cust-1" });
    }
  });

  it("invoice.created/refunded, subscription.payment_failed og usage-ekko registreres uden mutation", () => {
    for (const event of [
      "invoice.created",
      "invoice.refunded",
      "subscription.payment_failed",
      "customer.usage_recorded",
    ] as const) {
      expect(mapAluntaEvent(payload({ event })).kind).toBe("ignore");
    }
  });
});
