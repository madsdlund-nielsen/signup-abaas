import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ErasurePanel, ErasurePlanView } from "@/components/ErasurePanel";
import { ErasureReceiptList, ErasureReceiptPanel } from "@/components/ErasureReceipts";
import type { ErasureReceiptView } from "@/server/erasure/execute";
import type { ErasurePlan } from "@/server/erasure/plan";
import { toReceiptRow } from "@/server/erasure/receipts";

/** Sletteflade og kvittering (ADR 0068): ren præsentation, token-klasser, ingen inline-styles. */

const base: ErasurePlan = {
  userId: "11111111-1111-4111-8111-111111111111",
  roles: ["ejer"],
  displayName: "[DEMO] Eva Ejer",
  hasPartnerProfile: false,
  deletions: [
    { label: "Kvizsvar", count: 3, kind: "slettes" },
    { label: "Board-ændringsspor hvor personen var aktør (aktør nulstilles, rækken består anonymt)", count: 2, kind: "anonymiseres" },
  ],
  boardRemovals: [],
  upcomingBookingUids: [],
  hasBookings: false,
  blockers: [],
  externals: [
    { processor: "posthog", label: "PostHog (analytics, EU)", automatic: "Person slettes.", manual: null, manualIsGap: false },
    { processor: "inmobile", label: "inMobile (SMS)", automatic: null, manual: "Slettes manuelt.", manualIsGap: true },
  ],
  executable: true,
};

const noop = async () => ({});

describe("ErasurePanel", () => {
  it("starter med opslag og uden bekræftelse — der er intet at bekræfte før planen er vist", () => {
    const { container, queryByText, getByLabelText } = render(<ErasurePanel previewAction={noop} confirmAction={noop} />);
    expect(getByLabelText("E-mail på personen")).toBeTruthy();
    expect(queryByText("Slet permanent")).toBeNull();
    expect(container.textContent).toMatch(/opbevaringspligt/);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("ErasurePlanView", () => {
  it("viser hvad der slettes, hvad der anonymiseres og eksterne behandlere — uden e-mail og telefon", () => {
    const { container, getByText } = render(<ErasurePlanView plan={base} />);
    expect(getByText("Kvizsvar")).toBeTruthy();
    expect(getByText("Slettes")).toBeTruthy();
    expect(getByText("Anonymiseres")).toBeTruthy();
    expect(getByText("PostHog (analytics, EU)")).toBeTruthy();
    expect(getByText("Slettes manuelt.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/Blokeret/);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("NEGATIV: en blokeret plan siger det højt — opbevaringspligt som TODO(ejer/jura) — og nævner boards (B-68)", () => {
    const { container, getByRole } = render(
      <ErasurePlanView
        plan={{
          ...base,
          executable: false,
          blockers: [
            { code: "opbevaringspligt-betaling", message: "Afventer afklaring af opbevaringspligt (TODO(ejer/jura)): personen ejer et board med betalingsdata." },
            {
              code: "board-invariant",
              message: "Partneren kan ikke fjernes uden at bryde reglerne for 1 board.",
              boards: [{ id: "b1", name: "[DEMO] Board", reason: "Et board skal bestå af 2-3 partnere." }],
            },
          ],
        }}
      />,
    );
    expect(getByRole("alert").textContent).toMatch(/Afventer afklaring af opbevaringspligt \(TODO\(ejer\/jura\)\)/);
    expect(container.textContent).toMatch(/\[DEMO\] Board: Et board skal bestå af 2-3 partnere\./);
    expect(container.textContent).toMatch(/Der er ikke skrevet noget/);
  });

  it("boards partneren fjernes fra vises med antal før og efter", () => {
    const { container } = render(
      <ErasurePlanView
        plan={{
          ...base,
          hasPartnerProfile: true,
          boardRemovals: [{ boardId: "b1", boardName: "[DEMO] Board", expectedPartnerIds: ["a", "b", "c"], partnerId: "c", leadId: "a" }],
        }}
      />,
    );
    expect(container.textContent).toMatch(/\[DEMO\] Board — 3 → 2 partnere/);
  });
});

describe("kvitteringer", () => {
  const receipt: ErasureReceiptView = {
    id: "r1",
    executedAt: "2026-10-11T10:00:00Z",
    outcome: "gennemfoert",
    receiptSaved: true,
    missing: ["inmobile"],
    systems: [
      { system: "supabase", label: "Supabase (sandhedskilden)", status: "slettet", detail: "Slettet i én transaktion." },
      { system: "inmobile", label: "inMobile (SMS)", status: "manuel", detail: "Slettes manuelt." },
    ],
  };

  it("viser hvert system med udfald som tekst, og at noget mangler — et hul, ikke en gennemført sletning", () => {
    const { container, getByRole } = render(<ErasureReceiptPanel receipt={receipt} />);
    expect(container.textContent).toMatch(/Gennemført/);
    expect(container.textContent).toMatch(/Slettet/);
    expect(container.textContent).toMatch(/Manuelt/);
    expect(getByRole("alert").textContent).toMatch(/Mangler at blive slettet automatisk: inMobile \(SMS\)/);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("en delvis sletning forklarer at den kan genkøres", () => {
    const { container } = render(<ErasureReceiptPanel receipt={{ ...receipt, outcome: "delvist", missing: [] }} />);
    expect(container.textContent).toMatch(/kør sletningen om/);
  });

  it("en kvittering der ikke kunne gemmes, siger det", () => {
    const { container } = render(<ErasureReceiptPanel receipt={{ ...receipt, id: null, receiptSaved: false }} />);
    expect(container.textContent).toMatch(/kunne ikke gemmes/);
  });

  it("listen skelner 'ingen sletninger' fra 'kunne ikke læses'", () => {
    expect(render(<ErasureReceiptList receipts={[]} />).container.textContent).toMatch(/Ingen sletninger endnu/);
    const unreadable = render(<ErasureReceiptList receipts={null} />).container.textContent;
    expect(unreadable).toMatch(/kunne ikke læses/);
    expect(unreadable).not.toMatch(/Ingen sletninger endnu/);
  });

  it("listen viser kun et forkortet id-hash — aldrig noget der kan slå en person op", () => {
    const row = toReceiptRow({
      id: "r1",
      subject_hash: "a".repeat(64),
      executed_at: "2026-10-11T10:00:00Z",
      outcome: "delvist",
      systems: receipt.systems,
      missing: ["inmobile"],
    });
    const { container, getByText } = render(<ErasureReceiptList receipts={[row]} />);
    expect(getByText("a".repeat(12))).toBeTruthy();
    expect(container.textContent).not.toContain("a".repeat(13));
    expect(container.textContent).toMatch(/Delvist/);
    expect(container.textContent).toMatch(/inMobile \(SMS\)/);
  });
});
