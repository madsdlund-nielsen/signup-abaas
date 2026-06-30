import { describe, expect, it } from "vitest";
import { isEnabled } from "@/server/flags";

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
