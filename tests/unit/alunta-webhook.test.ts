import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  mapAluntaEvent,
  parseAluntaEvent,
  verifyAluntaSignature,
  type AluntaWebhookEvent,
} from "@/server/charges/webhook";

const SECRET = "alunta-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function event(overrides: Partial<AluntaWebhookEvent> = {}): AluntaWebhookEvent {
  return { eventId: "evt-1", type: "charge.gennemfoert", chargeRef: "ch-1", ...overrides };
}

describe("alunta-webhook-signatur (må aldrig stubbes; form er provisorisk — TODO(mads))", () => {
  it("gyldig signatur verificerer; forkert secret/body/manglende afvises", () => {
    const body = JSON.stringify(event());
    expect(verifyAluntaSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyAluntaSignature(body, sign(body, "andet"), SECRET)).toBe(false);
    expect(verifyAluntaSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyAluntaSignature(body, null, SECRET)).toBe(false);
  });
});

describe("parseAluntaEvent", () => {
  it("accepterer de tre kendte typer", () => {
    expect(parseAluntaEvent(event())).not.toBeNull();
    expect(parseAluntaEvent(event({ type: "charge.fejlet" }))).not.toBeNull();
    expect(
      parseAluntaEvent(event({ type: "kort.registreret", customerRef: "m-1" })),
    ).not.toBeNull();
  });

  it("NEGATIV: ukendt type, manglende eventId eller ikke-objekt → null", () => {
    expect(parseAluntaEvent({ ...event(), type: "refund.oprettet" })).toBeNull();
    expect(parseAluntaEvent({ ...event(), eventId: "" })).toBeNull();
    expect(parseAluntaEvent(null)).toBeNull();
    expect(parseAluntaEvent("streng")).toBeNull();
  });
});

describe("mapAluntaEvent (webhooks opdaterer status — opretter aldrig)", () => {
  it("gennemført/fejlet mapper til charge-opdatering via provider_charge_ref", () => {
    const ok = mapAluntaEvent(event());
    expect(ok).toEqual({ kind: "charge", chargeRef: "ch-1", update: { status: "gennemfoert" } });

    const failed = mapAluntaEvent(event({ type: "charge.fejlet", failureReason: "Kort afvist" }));
    expect(failed).toEqual({
      kind: "charge",
      chargeRef: "ch-1",
      update: { status: "fejlet", failure_reason: "Kort afvist" },
    });
  });

  it("kort.registreret mapper til membership-opdatering via customerRef", () => {
    expect(mapAluntaEvent(event({ type: "kort.registreret", customerRef: "m-1" }))).toEqual({
      kind: "card",
      customerRef: "m-1",
    });
  });

  it("NEGATIV: manglende reference → null (logges + ignoreres i routen)", () => {
    expect(mapAluntaEvent(event({ chargeRef: undefined }))).toBeNull();
    expect(mapAluntaEvent(event({ type: "kort.registreret", customerRef: undefined }))).toBeNull();
  });
});
