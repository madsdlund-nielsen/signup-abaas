import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { PricingRuleForm } from "@/components/PricingRuleForm";
import { computeMeetingFee, formatMinor } from "@/server/pricing/algorithm";
import type { PricingRuleInput } from "@/server/pricing/algorithm";

/**
 * Prisregel-UI (fase 3, ADR 0030). Testværdierne er åbenlyst syntetiske — de reelle satser
 * er ejer-uafklarede og indtastes af admin (docs/stub-politik.md: skriv aldrig et plausibelt
 * forretningstal). Forventede beløb udledes af `computeMeetingFee`/`formatMinor`, så testen
 * låser KOMPONENTENS visning fast, ikke en kopi af formlen.
 */
function rule(overrides: Partial<PricingRuleInput> = {}): PricingRuleInput {
  return {
    id: "r1",
    version: 1,
    baseAmountMinor: 100,
    perPartnerAmountMinor: 10,
    factor4Weeks: 1,
    factor8Weeks: 0.5,
    factor12Weeks: 0.25,
    currency: "DKK",
    ...overrides,
  };
}

describe("PriceBreakdown — det brudte regnestykke (delt admin/ejer)", () => {
  it("viser alle fire linjer med token-klasser og uden inline-style", () => {
    const { container } = render(<PriceBreakdown rule={rule()} partnerCount={2} frequencyWeeks={4} />);

    const table = container.querySelector("table");
    expect(table?.className).toBe("table");
    expect(table?.getAttribute("style")).toBeNull();

    const rows = container.querySelectorAll("tr.table__row");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.getAttribute("style")).toBeNull();
  });

  it("viser samme totalbeløb som computeMeetingFee (ingen egen formel i UI'et)", () => {
    const fee = computeMeetingFee(rule(), 3, 8);
    const { container } = render(<PriceBreakdown rule={rule()} partnerCount={3} frequencyWeeks={8} />);

    const text = container.textContent ?? "";
    expect(text).toContain(formatMinor(fee.amountMinor, fee.currency));
    expect(text).toContain(formatMinor(fee.breakdown.baseAmountMinor, fee.currency));
  });

  it("navngiver partnerantal og frekvens i regnestykket", () => {
    const { container } = render(<PriceBreakdown rule={rule()} partnerCount={3} frequencyWeeks={12} />);
    const text = container.textContent ?? "";
    expect(text).toContain("3 partnere");
    expect(text).toContain("hver 12. uge");
  });
});

describe("PricingRuleForm — preview inden gem (ADR 0017-mønstret)", () => {
  const noop = async () => ({});

  it("bevarer felternes name, så FormData-kontrakten til server-actionen er uændret", () => {
    const { container } = render(<PricingRuleForm action={noop} nextVersion={3} />);
    const names = Array.from(container.querySelectorAll("input")).map((i) => i.getAttribute("name"));
    expect(names).toEqual([
      "base_amount_minor",
      "per_partner_amount_minor",
      "factor_4_weeks",
      "factor_8_weeks",
      "factor_12_weeks",
    ]);
  });

  it("navngiver næste version på gem-knappen", () => {
    const { getByRole } = render(<PricingRuleForm action={noop} nextVersion={7} />);
    expect(getByRole("button", { name: "Gem som version 7" })).toBeTruthy();
  });

  it("preview er skjult indtil den slås til", () => {
    const { getByRole, container } = render(<PricingRuleForm action={noop} nextVersion={1} />);
    const toggle = getByRole("button", { name: "Vis preview (inden gem)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("table.table")).toBeNull();
  });

  it("NEGATIV: tomme felter giver ingen preview-tabel, men en forklarende besked", () => {
    const { getByRole, container } = render(<PricingRuleForm action={noop} nextVersion={1} />);
    fireEvent.click(getByRole("button", { name: "Vis preview (inden gem)" }));

    expect(container.querySelector("table.table")).toBeNull();
    expect(getByRole("status").textContent).toContain("Udfyld alle felter");
  });

  it("gyldige værdier previewer 2-3 partnere × 4/8/12 uger — seks regnestykker", () => {
    const { getByRole, getByLabelText, container } = render(
      <PricingRuleForm action={noop} nextVersion={1} />,
    );

    fireEvent.change(getByLabelText("Grundpris pr. møde (øre)"), { target: { value: "100" } });
    fireEvent.change(getByLabelText("Pris pr. partner pr. møde (øre)"), { target: { value: "10" } });
    fireEvent.change(getByLabelText("Faktor — hver 4. uge"), { target: { value: "1" } });
    fireEvent.change(getByLabelText("Faktor — hver 8. uge"), { target: { value: "0.5" } });
    fireEvent.change(getByLabelText("Faktor — hver 12. uge"), { target: { value: "0.25" } });
    fireEvent.click(getByRole("button", { name: "Vis preview (inden gem)" }));

    expect(container.querySelectorAll("table.table")).toHaveLength(6);

    // Preview'et bruger SAMME beregning som ejeren møder.
    const fee = computeMeetingFee(rule({ id: "preview" }), 2, 4);
    expect(container.textContent).toContain(formatMinor(fee.amountMinor, fee.currency));
  });

  it("preview kan slås fra igen", () => {
    const { getByRole } = render(<PricingRuleForm action={noop} nextVersion={1} />);
    fireEvent.click(getByRole("button", { name: "Vis preview (inden gem)" }));
    const toggle = getByRole("button", { name: "Skjul preview" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(getByRole("button", { name: "Vis preview (inden gem)" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
