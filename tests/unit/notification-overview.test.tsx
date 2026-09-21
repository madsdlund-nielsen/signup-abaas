import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { NotificationOverview } from "@/components/NotificationOverview";
import type { NotificationOverviewState } from "@/server/notifications";

const stubState: NotificationOverviewState = {
  channels: [
    {
      key: "email",
      label: "E-mail",
      vendor: "Resend (EU, Dublin)",
      flag: "email",
      state: "stub",
      flagEnabled: false,
      unlockedBy: "Resend-konto, nøgle og FLAG_EMAIL",
    },
    {
      key: "sms",
      label: "SMS",
      vendor: "inMobile (DK)",
      flag: "sms",
      state: "stub",
      flagEnabled: true,
      unlockedBy: "inMobile-konto, nøgle og FLAG_SMS",
    },
  ],
  types: [
    {
      key: "meeting-reminder",
      label: "Mødepåmindelse",
      trigger: "Et kommende møde nærmer sig",
      recipients: "Ejer og boardets partnere",
      channels: ["email", "sms"],
      timing: null,
    },
    {
      key: "payment-failed",
      label: "Fejlet betaling",
      trigger: "Alunta melder et mislykket træk",
      recipients: "Ejer",
      channels: ["email"],
      timing: "Straks ved fejlet træk",
    },
  ],
  anyChannelLive: false,
};

/** Notifikationsoversigten (fase 4.5/4.6, skærm-først): token-klasser, ingen inline-styles. */
describe("NotificationOverview", () => {
  it("siger 'sender ikke' om en stub-kanal — aldrig at den er klar", () => {
    const { getByText, queryByText } = render(<NotificationOverview state={stubState} />);
    expect(getByText(/Sender ikke — Resend-konto, nøgle og FLAG_EMAIL/)).toBeTruthy();
    expect(queryByText("Sender")).toBeNull();
  });

  it("skelner et slukket flag fra manglende nøgler", () => {
    const { getByText } = render(<NotificationOverview state={stubState} />);
    // SMS har flaget tændt, så hullet er nøglerne — og det skal stå der.
    expect(getByText(/nøgler mangler/)).toBeTruthy();
  });

  it("viser 'Ikke fastlagt' frem for at opfinde et tidspunkt", () => {
    const { getByText } = render(<NotificationOverview state={stubState} />);
    expect(getByText("Ikke fastlagt")).toBeTruthy();
    expect(getByText("Straks ved fejlet træk")).toBeTruthy();
  });

  it("tager forbehold så længe ingen kanal kan sende", () => {
    const { container } = render(<NotificationOverview state={stubState} />);
    expect(container.querySelector("p.empty")?.textContent).toMatch(/Ingen kanal kan sende endnu/);
  });

  it("dropper forbeholdet når en kanal er live, og kalder den 'Sender'", () => {
    const live: NotificationOverviewState = {
      ...stubState,
      channels: [{ ...stubState.channels[0]!, state: "live", flagEnabled: true }],
      anyChannelLive: true,
    };
    const { container, getByText } = render(<NotificationOverview state={live} />);
    expect(container.querySelector("p.empty")).toBeNull();
    expect(getByText("Sender")).toBeTruthy();
  });

  it("bruger kun token-klasser — ingen inline-styles", () => {
    const { container } = render(<NotificationOverview state={stubState} />);
    const styled = [...container.querySelectorAll("*")].filter((el) => el.getAttribute("style"));
    expect(styled).toHaveLength(0);
    expect(container.querySelectorAll("table.table")).toHaveLength(2);
  });
});
