import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AvailabilityWeek } from "@/components/AvailabilityWeek";
import { CommonWindowsList } from "@/components/CommonWindowsList";

describe("AvailabilityWeek", () => {
  const slots = [
    { id: "s2", weekday: 1, startTime: "13:00:00", endTime: "16:00:00" },
    { id: "s1", weekday: 1, startTime: "09:00:00", endTime: "12:00:00" },
    { id: "s3", weekday: 5, startTime: "10:00", endTime: "14:00" },
  ];

  it("viser syv ugedage mandag-søndag, og vinduerne sorteret pr. dag uden sekunder", () => {
    const { container } = render(<AvailabilityWeek slots={slots} />);
    const days = container.querySelectorAll(".weekgrid__day");
    expect(days).toHaveLength(7);
    expect(days[0]?.textContent).toContain("Man");
    expect(days[6]?.textContent).toContain("Søn");
    const monday = days[0]?.querySelectorAll(".weekgrid__time");
    expect([...(monday ?? [])].map((n) => n.textContent)).toEqual(["09:00–12:00", "13:00–16:00"]);
    expect(days[4]?.textContent).toContain("10:00–14:00");
  });

  it("dage uden vinduer viser en tankestreg", () => {
    const { container } = render(<AvailabilityWeek slots={[]} />);
    expect(container.querySelectorAll(".weekgrid__none")).toHaveLength(7);
  });

  it("skrivebeskyttet uden removeAction; med removeAction en fjern-knap pr. vindue", () => {
    const { container, rerender } = render(<AvailabilityWeek slots={slots} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    rerender(<AvailabilityWeek slots={slots} removeAction={vi.fn()} />);
    expect(container.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByLabelText("Fjern Fredag 10:00–14:00")).toBeTruthy();
    expect(container.querySelector('input[name="slot_id"][value="s3"]')).toBeTruthy();
  });

  it("styles udelukkende via token-klasser — ingen inline-styles", () => {
    const { container } = render(<AvailabilityWeek slots={slots} removeAction={vi.fn()} />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("CommonWindowsList", () => {
  it("uden begrænsninger: siger at alle tidspunkter kan bookes og lister intet", () => {
    const { container } = render(
      <CommonWindowsList windows={[]} anyRestriction={false} restrictedNames={[]} />,
    );
    expect(container.textContent).toContain("alle tidspunkter kan bookes");
    expect(container.querySelector(".slotlist")).toBeNull();
  });

  it("begrænset men uden fælles tid: ærlig tom tilstand", () => {
    const { container } = render(
      <CommonWindowsList windows={[]} anyRestriction restrictedNames={["Partner Én"]} />,
    );
    expect(container.querySelector(".empty")?.textContent).toContain("ingen tidspunkter");
  });

  it("grupperer pr. dag i dansk tid og navngiver hvem der begrænser", () => {
    const { container } = render(
      <CommonWindowsList
        anyRestriction
        restrictedNames={["Partner Én", "Partner To"]}
        windows={[
          { start: "2026-10-12T07:00:00Z", end: "2026-10-12T10:00:00Z" }, // man 09-12 dansk
          { start: "2026-10-12T12:00:00Z", end: "2026-10-12T14:00:00Z" }, // man 14-16
          { start: "2026-10-13T08:00:00Z", end: "2026-10-13T09:00:00Z" }, // tir 10-11
        ]}
      />,
    );
    const rows = container.querySelectorAll(".slotlist__row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(".slotlist__day")?.textContent).toContain("mandag");
    expect(rows[0]?.querySelectorAll(".slotlist__time")).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("09:00–12:00");
    expect(rows[0]?.textContent).toContain("14:00–16:00");
    expect(rows[1]?.textContent).toContain("10:00–11:00");
    expect(container.textContent).toContain("Partner Én, Partner To");
  });

  it("markerer et vindue der krydser midnat", () => {
    const { container } = render(
      <CommonWindowsList
        anyRestriction
        restrictedNames={["A"]}
        windows={[{ start: "2026-10-12T20:00:00Z", end: "2026-10-12T23:00:00Z" }]} // 22:00 → 01:00
      />,
    );
    expect(container.querySelector(".slotlist__time")?.textContent).toMatch(
      /^22:00–01:00 \(tir/,
    );
  });

  it("ingen inline-styles", () => {
    const { container } = render(
      <CommonWindowsList
        anyRestriction
        restrictedNames={["A"]}
        windows={[{ start: "2026-10-12T07:00:00Z", end: "2026-10-12T10:00:00Z" }]}
      />,
    );
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
