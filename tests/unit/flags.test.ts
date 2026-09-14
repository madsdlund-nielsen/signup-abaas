import { describe, expect, it } from "vitest";
import { isDemoMode, isEnabled } from "@/server/flags";

describe("feature-flags", () => {
  it("integrationsflag er OFF som standard", () => {
    expect(isEnabled("payments", {})).toBe(false);
  });

  it("flag tændes via FLAG_<NAVN>=true", () => {
    expect(isEnabled("payments", { FLAG_PAYMENTS: "true" })).toBe(true);
  });

  it("inAppMessaging holdes mørklagt uanset env (uafklaret modul)", () => {
    expect(isEnabled("inAppMessaging", { FLAG_INAPPMESSAGING: "true" })).toBe(false);
  });
});

describe("demo-tilstand (ADR 0041)", () => {
  it("er OFF som standard", () => {
    expect(isDemoMode({})).toBe(false);
  });

  it("tændes via FLAG_DEMO=true", () => {
    expect(isDemoMode({ FLAG_DEMO: "true" })).toBe(true);
  });

  it("er ikke et modulflag — FLAG_DEMO tænder ingen integration", () => {
    expect(isEnabled("payments", { FLAG_DEMO: "true" })).toBe(false);
    expect(isEnabled("booking", { FLAG_DEMO: "true" })).toBe(false);
  });
});
