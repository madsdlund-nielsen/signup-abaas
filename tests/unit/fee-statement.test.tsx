import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FeeFigures, FeeLinesTable, FeeNotices, PeriodNav } from "@/components/FeeStatement";
import { summarizeFees, type FeeRuleInput } from "@/server/fees/algorithm";
import { buildFeeLines, type FeeLineRow } from "@/server/fees/lines";

/**
 * Honoraropgørelsens byggeklodser (fase 5.1/5.2, skærm-først). Token-klasser, ingen inline-styles —
 * og skærmen lover ikke mere end den kan holde: ingen sats / ingen regel giver aldrig et beløb.
 */
const RULE: FeeRuleInput = {
  id: "r1",
  version: 1,
  hourlyRateMinor: 6000,
  currency: "DKK",
  vatMode: "ikke_fastlagt",
  absenceRule: "ikke_fastlagt",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

function row(overrides: Partial<FeeLineRow> = {}): FeeLineRow {
  return {
    meetingId: "m1",
    partnerProfileId: "p1",
    partnerName: "Partner Én",
    startsAt: "2026-10-05T10:00:00Z",
    meetingStatus: "afholdt",
    durationMinutes: 60,
    prepMinutes: 15,
    registeredStatus: "afholdt",
    ...overrides,
  };
}

function totalsFor(rows: FeeLineRow[], rules: FeeRuleInput[]) {
  const lines = buildFeeLines(rows, rules);
  return { lines, totals: summarizeFees(lines.map((line) => line.result)) };
}

function expectTokenOnly(container: HTMLElement) {
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
}

describe("PeriodNav", () => {
  it("viser valgt måned og linker til forrige/næste og bevarer øvrige parametre", () => {
    const { container } = render(
      <PeriodNav month="2026-12" basePath="/admin/honorar" extra={{ partner: "p-1" }} />,
    );
    expect(screen.getByText("December 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forrige" }).getAttribute("href")).toBe(
      "/admin/honorar?partner=p-1&maaned=2026-11",
    );
    expect(screen.getByRole("link", { name: "Næste" }).getAttribute("href")).toBe(
      "/admin/honorar?partner=p-1&maaned=2027-01",
    );
    expectTokenOnly(container);
  });
});

describe("FeeFigures", () => {
  it("viser sum, afholdte møder og linjer uden beløb", () => {
    const { totals } = totalsFor(
      [
        row({ meetingId: "a" }),
        row({ meetingId: "b" }),
        row({ meetingId: "c", registeredStatus: "udeblivelse" }),
        row({ meetingId: "d", registeredStatus: null }),
      ],
      [RULE],
    );
    const { container } = render(<FeeFigures totals={totals} />);
    expect(screen.getByText(/150,00/)).toBeTruthy(); // 2 × 75 → 2 × 75,00 kr
    expect(screen.getByText("Afholdte møder").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("Uden beløb").nextElementSibling?.textContent).toBe("2");
    expectTokenOnly(container);
  });

  it("viser en tankestreg — ikke 0 kr — når intet er beregnet", () => {
    const { totals } = totalsFor([row()], []);
    render(<FeeFigures totals={totals} />);
    expect(screen.getByText("Honorar i perioden").nextElementSibling?.textContent).toBe("—");
    expect(screen.getByText("Intet beregnet endnu")).toBeTruthy();
  });
});

describe("FeeNotices", () => {
  it("siger højt at satsen ikke er fastlagt, når der ingen regel findes", () => {
    const { totals } = totalsFor([row()], []);
    render(<FeeNotices totals={totals} hasRules={false} />);
    expect(screen.getByText(/Honorarsatsen er ikke fastlagt endnu/)).toBeTruthy();
  });

  it("forklarer afventende afbud/udeblivelse og at momsen ikke er fastlagt", () => {
    const { totals } = totalsFor(
      [row({ meetingId: "a" }), row({ meetingId: "b", registeredStatus: "forsinket_afbud" })],
      [RULE],
    );
    const { container } = render(<FeeNotices totals={totals} hasRules />);
    expect(screen.getByText(/afventer en regel for honorar ved udeblivelse/)).toBeTruthy();
    expect(screen.getByText(/Moms ikke fastlagt/)).toBeTruthy();
    expect(screen.getByText(/uden momsbehandling/)).toBeTruthy();
    expect(screen.queryByText(/Honorarsatsen er ikke fastlagt endnu/)).toBeNull();
    expectTokenOnly(container);
  });

  it("beregner aldrig moms: en sat momsmåde vises kun som angivet af reglen", () => {
    const { totals } = totalsFor([row()], [{ ...RULE, vatMode: "ekskl_moms" }]);
    render(<FeeNotices totals={totals} hasRules />);
    expect(screen.getByText(/Ekskl\. moms/)).toBeTruthy();
    expect(screen.getByText(/Der er ikke regnet moms/)).toBeTruthy();
  });

  it("er tom for forbehold i en periode uden problemer og uden beregnede linjer", () => {
    const { container } = render(
      <FeeNotices totals={totalsFor([], [RULE]).totals} hasRules />,
    );
    expect(container.querySelector(".form__notice")).toBeNull();
  });
});

describe("FeeLinesTable", () => {
  it("viser en tom tilstand uden møder", () => {
    render(<FeeLinesTable lines={[]} />);
    expect(screen.getByText("Ingen møder i perioden.")).toBeTruthy();
  });

  it("viser beløb kun hvor der er et grundlag, og årsagen hvor der ikke er", () => {
    const { lines, totals } = totalsFor(
      [
        row({ meetingId: "a" }),
        row({ meetingId: "b", registeredStatus: null, startsAt: "2026-10-04T10:00:00Z" }),
        row({ meetingId: "c", registeredStatus: "udeblivelse", startsAt: "2026-10-03T10:00:00Z" }),
        row({ meetingId: "d", startsAt: "2025-01-01T10:00:00Z" }), // før reglen
      ],
      [RULE],
    );
    const { container } = render(<FeeLinesTable lines={lines} totals={totals} linkMeetings />);
    expect(screen.getByText("Mødet er ikke registreret endnu")).toBeTruthy();
    expect(screen.getByText(/Udeblivelse — afventer regel/)).toBeTruthy();
    expect(screen.getByText("Ingen honorarsats gælder for mødetidspunktet")).toBeTruthy();
    expect(screen.getAllByText(/75,00/).length).toBeGreaterThan(0);
    expect(screen.getByText("I alt")).toBeTruthy();
    expect(container.querySelectorAll("a[href^='/moeder/']")).toHaveLength(4);
    expectTokenOnly(container);
  });

  it("viser partnerkolonnen for admin og ingen mødelinks som standard", () => {
    const { lines } = totalsFor([row()], [RULE]);
    const { container } = render(<FeeLinesTable lines={lines} showPartner />);
    expect(screen.getByText("Partner Én")).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
