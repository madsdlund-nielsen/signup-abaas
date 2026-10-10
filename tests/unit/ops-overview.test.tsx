import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  ConsentLogGap,
  ErasureReference,
  LegalDocumentTable,
  SubjectAccessForm,
} from "@/components/LegalInterface";
import { IntegrationStatusTable, OpsOverview, Stat, integrationNote } from "@/components/OpsOverview";
import { LEGAL_DOCUMENTS, subjectAccessErrorMessage } from "@/server/admin/legal";
import type { IntegrationOverview, IntegrationStatus } from "@/server/admin";
import type { OpsOverview as OpsState } from "@/server/admin";

function integration(overrides: Partial<IntegrationStatus>): IntegrationStatus {
  return {
    key: "booking",
    label: "Booking",
    vendor: "Cal.com (Teams)",
    flag: "booking",
    flagEnv: "FLAG_BOOKING",
    flagEnabled: false,
    mode: "stub",
    adapter: "stub",
    ...overrides,
  };
}

const integrations: IntegrationOverview = {
  integrations: [
    integration({}),
    integration({ key: "video", label: "Video", flag: "video", flagEnv: "FLAG_VIDEO", flagEnabled: true }),
    integration({ key: "payments", label: "Betaling ind", mode: "demo", adapter: "demo" }),
    integration({ key: "email", label: "E-mail", mode: "real", adapter: "resend", flagEnabled: true }),
  ],
  demoMode: true,
  counts: { real: 1, demo: 1, stub: 2 },
};

const ops: OpsState = {
  generatedAt: "2026-10-10T12:00:00.000Z",
  platform: { boards: 3, ownersWithBoard: 2, partners: 5, partnersLinked: 4, partnersUnlinked: 1 },
  memberships: { total: 2, active: 2, cancelled: 0, cardRegistered: 1, cardMissing: 1 },
  charges: {
    pending: 0,
    succeeded: 1,
    failed: 1,
    recentFailures: [{ id: "c1", failedAt: "2026-10-09T08:00:00Z", reason: "card_declined" }],
  },
  meetings: { windowDays: 30, upcoming: 2, overdue: 0, held: 4, cancelled: 1 },
  missingRegistrations: { meetings: 1, registrations: 2 },
  webhooks: { meeting: [], payment: [{ provider: "alunta", eventType: "charge.failed", receivedAt: "2026-10-09T08:00:00Z" }] },
  truncated: false,
};

describe("Stat", () => {
  it("viser tallet, og '—' når sektionen ikke kunne læses (aldrig et nul)", () => {
    const { getByText, rerender } = render(<Stat label="Boards" value={3} />);
    expect(getByText("3")).toBeTruthy();
    rerender(<Stat label="Boards" value={null} />);
    expect(getByText("—")).toBeTruthy();
  });

  it("markerer et gulv med ≥", () => {
    const { getByText } = render(<Stat label="Boards" value={1000} atLeast />);
    expect(getByText("≥ 1000")).toBeTruthy();
  });
});

describe("IntegrationStatusTable", () => {
  it("skelner rigtig, demo og stub — og slukket flag fra manglende nøgler", () => {
    const { getByText } = render(<IntegrationStatusTable overview={integrations} />);
    expect(getByText("Rigtig")).toBeTruthy();
    expect(getByText("Demo")).toBeTruthy();
    expect(getByText(/Flaget er slukket — FLAG_BOOKING/)).toBeTruthy();
    expect(getByText(/Flaget er tændt, men nøglerne mangler — FLAG_VIDEO/)).toBeTruthy();
  });

  it("advarer når demo-tilstand er tændt", () => {
    const { container } = render(<IntegrationStatusTable overview={integrations} />);
    expect(container.querySelector(".form__notice")?.textContent).toMatch(/FLAG_DEMO/);
  });

  it("tier om demo når den er slået fra", () => {
    const { container } = render(
      <IntegrationStatusTable overview={{ ...integrations, demoMode: false }} />,
    );
    expect(container.querySelector(".form__notice")).toBeNull();
  });

  it("integrationNote dækker alle tre tilstande", () => {
    expect(integrationNote(integration({ mode: "real" }))).toMatch(/leverandøren/);
    expect(integrationNote(integration({ mode: "demo" }))).toMatch(/falsk/);
    expect(integrationNote(integration({ mode: "stub" }))).toMatch(/slukket/);
  });
});

describe("OpsOverview", () => {
  it("viser tallene tal-først, årsagen på fejlede træk og webhook-hændelser", () => {
    const { getByText, container } = render(<OpsOverview ops={ops} integrations={integrations} />);
    expect(getByText("Boards")).toBeTruthy();
    expect(getByText("card_declined")).toBeTruthy();
    expect(getByText("charge.failed")).toBeTruthy();
    expect(getByText("Ingen hændelser modtaget endnu.")).toBeTruthy();
    expect(container.querySelectorAll(".stat").length).toBeGreaterThan(10);
  });

  it("siger at en sektion ikke kunne læses i stedet for at vise nuller", () => {
    const { container, getAllByText } = render(
      <OpsOverview ops={{ ...ops, charges: null }} integrations={integrations} />,
    );
    expect(container.textContent).toMatch(/Kunne ikke læses/);
    expect(getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("uden Supabase vises integrationsstatus alligevel, uden driftstal", () => {
    const { container, getByText } = render(<OpsOverview ops={null} integrations={integrations} />);
    expect(container.textContent).toMatch(/Supabase er ikke konfigureret/);
    expect(container.querySelectorAll(".stat")).toHaveLength(0);
    expect(getByText("Integrationer")).toBeTruthy();
  });

  it("forbeholder sig når en sektion ramte rækkegrænsen", () => {
    const { container } = render(<OpsOverview ops={{ ...ops, truncated: true }} integrations={integrations} />);
    expect(container.textContent).toMatch(/gulv/);
    expect(container.textContent).toMatch(/≥ 3/);
  });

  it("bruger kun token-klasser — ingen inline-styles", () => {
    const { container } = render(<OpsOverview ops={ops} integrations={integrations} />);
    expect([...container.querySelectorAll("*")].filter((el) => el.getAttribute("style"))).toHaveLength(0);
  });
});

describe("Juridisk interface", () => {
  it("formularen POST'er til route handleren — e-mailen kommer aldrig i URL'en", () => {
    const { container } = render(<SubjectAccessForm error={null} />);
    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/admin/indsigt");
    expect(container.querySelector("input[name=email][type=email]")).toBeTruthy();
  });

  it("viser en fejlkode som tekst", () => {
    const { getByRole } = render(<SubjectAccessForm error={subjectAccessErrorMessage("ikke-fundet")} />);
    expect(getByRole("alert").textContent).toMatch(/Ingen konto/);
    expect(subjectAccessErrorMessage(undefined)).toBeNull();
    expect(subjectAccessErrorMessage("noget-ukendt")).toMatch(/kunne ikke/);
  });

  it("siger at samtykkelog mangler, frem for at tilbyde en tom eksport", () => {
    const { container } = render(<ConsentLogGap />);
    expect(container.textContent).toMatch(/Ingen samtykkelog at eksportere/);
    expect(container.querySelector("a")).toBeNull();
  });

  it("ToS og honoraraftale står som 'Ikke udarbejdet' — registret som sti, ikke som indhold", () => {
    const { getAllByText, getByText } = render(<LegalDocumentTable documents={LEGAL_DOCUMENTS} />);
    expect(getAllByText("Ikke udarbejdet")).toHaveLength(2);
    expect(getByText("docs/gdpr/leverandoer-register.md")).toBeTruthy();
  });

  it("henviser til sletteflowet og siger at der ikke er en sletteknap", () => {
    const { container } = render(<ErasureReference />);
    expect(container.textContent).toMatch(/docs\/gdpr\/sletteflow\.md/);
    expect(container.textContent).toMatch(/ingen\s+admin-sletteaction/);
    expect(container.querySelector("button")).toBeNull();
  });
});
