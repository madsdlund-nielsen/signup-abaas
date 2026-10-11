import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { StatusBadge } from "@/components/StatusBadge";
import { TemplateEditor, type TemplateEditorProps } from "@/components/TemplateEditor";
import { NotificationOverview } from "@/components/NotificationOverview";
import { getNotificationOverview } from "@/server/notifications";
import { NOTIFICATION_TYPES } from "@/server/notifications/catalog";
import { PREVIEW_EXAMPLES } from "@/server/notifications/examples";
import { groupByChannel, summarize, type TemplateVersion } from "@/server/notifications/template-state";

/**
 * Skabelon-editoren (fase 4.6, ADR 0057): live preview mens man skriver, og en tydelig
 * markering af hvad der er LIVE og hvad der kun er udkast. Alle tekster er åbenlyst syntetiske.
 */
const TYPE = NOTIFICATION_TYPES.find((t) => t.key === "meeting-changed")!;

function version(overrides: Partial<TemplateVersion>): TemplateVersion {
  return {
    id: "v1",
    typeKey: TYPE.key,
    channel: "email",
    version: 1,
    status: "live",
    subject: "[DEMO] Emne {{aendring}}",
    body: "[DEMO] Tekst om {{board_navn}}",
    publishedAt: "2026-10-01T10:00:00Z",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

function setup(versions: TemplateVersion[], actionOverrides: Partial<TemplateEditorProps["actions"]> = {}) {
  const actions = {
    save: vi.fn(async () => ({ notice: "Udkast gemt." })),
    publish: vi.fn(async () => ({ notice: "Publiceret." })),
    discard: vi.fn(async () => ({ notice: "Forkastet." })),
    ...actionOverrides,
  };
  const channels = groupByChannel(versions, TYPE.channels).map((state) => ({
    label: state.channel === "email" ? "E-mail" : "SMS",
    state,
  }));
  const utils = render(
    <TemplateEditor
      typeKey={TYPE.key}
      channels={channels}
      variables={TYPE.variables}
      examples={PREVIEW_EXAMPLES}
      actions={actions}
    />,
  );
  return { ...utils, actions };
}

const live = version({});
const sameDraft = version({ id: "v2", version: 2, status: "udkast", publishedAt: null });
const otherDraft = version({ id: "v2", version: 2, status: "udkast", publishedAt: null, body: "[DEMO] Ny tekst" });

describe("TemplateEditor — LIVE vs. udkast (eksplicit krav)", () => {
  it("uden nogen version: 'Ingen live' og en forklaring på at motoren intet sender", () => {
    const { getByText, container } = setup([]);
    expect(getByText("Ingen live")).toBeTruthy();
    expect(container.textContent).toMatch(/ingen live skabelon på denne kanal/);
    expect(container.textContent).toMatch(/fejlet: ingen live skabelon/);
    expect(container.querySelector(".status-badge--live")).toBeNull();
  });

  it("viser et LIVE-mærke med versionsnummer, og intet advarsel når der ikke er et afvigende udkast", () => {
    const { container } = setup([live]);
    const badge = container.querySelector(".status-badge--live");
    expect(badge?.textContent).toBe("Live · v1");
    expect(container.textContent).not.toMatch(/afviger fra den live version/);
  });

  it("advarer tydeligt når det gemte udkast afviger fra live, og siger at udkastet IKKE er i brug", () => {
    const { container } = setup([live, otherDraft]);
    expect(container.querySelector(".status-badge--live")?.textContent).toBe("Live · v1");
    expect(container.querySelector(".status-badge--draft")?.textContent).toBe("Udkast · v2");
    expect(container.textContent).toMatch(/afviger fra den live version \(v1\)/);
    expect(container.textContent).toMatch(/udkastet er IKKE i brug/);
  });

  it("advarer ikke når udkastet er identisk med live", () => {
    const { container } = setup([live, sameDraft]);
    expect(container.textContent).not.toMatch(/afviger fra den live version/);
  });

  it("markerer ændringer der ikke er gemt", () => {
    const { container, getByLabelText } = setup([live]);
    expect(container.textContent).not.toMatch(/ikke er gemt/);
    fireEvent.change(getByLabelText("Tekst"), { target: { value: "[DEMO] Noget andet" } });
    expect(container.textContent).toMatch(/ændringer der ikke er gemt/);
  });

  it("versionshistorikken viser hver version med sit mærke", () => {
    const archived = version({ id: "v0", version: 1, status: "arkiveret" });
    const newer = version({ id: "v9", version: 2, status: "live" });
    const { container } = setup([newer, archived]);
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows[0]).toMatch(/v2.*Live/);
    expect(rows[1]).toMatch(/v1.*Arkiveret/);
  });
});

describe("TemplateEditor — live preview (eksplicit krav)", () => {
  it("opdaterer previewet mens man skriver, med åbenlyst falske eksempelværdier", () => {
    const { container, getByLabelText } = setup([live]);
    fireEvent.change(getByLabelText("Tekst"), { target: { value: "[DEMO] Hej fra {{board_navn}}" } });
    const preview = container.querySelector(".preview__body");
    expect(preview?.textContent).toBe(`[DEMO] Hej fra ${PREVIEW_EXAMPLES.board_navn}`);
    expect(container.querySelector(".preview__body .preview__value")?.textContent).toBe(PREVIEW_EXAMPLES.board_navn);
  });

  it("opdaterer emnet i previewet", () => {
    const { container, getByLabelText } = setup([live]);
    fireEvent.change(getByLabelText("Emne"), { target: { value: "[DEMO] {{aendring}}" } });
    expect(container.querySelector(".preview__subject")?.textContent).toContain(PREVIEW_EXAMPLES.aendring);
  });

  it("markerer en ukendt variabel i previewet — aldrig et stille tomt felt — og spærrer publicering", () => {
    const { container, getByLabelText, getByText } = setup([live]);
    fireEvent.change(getByLabelText("Tekst"), { target: { value: "Kære {{ejer_navn}}" } });

    const problem = container.querySelector("mark.preview__problem");
    expect(problem?.textContent).toBe("{{ejer_navn}}");
    expect(container.querySelector(".preview__problems")?.textContent).toMatch(/«ejer_navn» findes ikke/);
    expect((getByText("Publicér…") as HTMLButtonElement).disabled).toBe(true);
  });

  it("kan skifte mellem preview af din tekst og af den live version", () => {
    const { container, getByLabelText, getByText } = setup([live]);
    fireEvent.change(getByLabelText("Tekst"), { target: { value: "[DEMO] Udkasttekst" } });
    expect(container.querySelector(".preview__body")?.textContent).toBe("[DEMO] Udkasttekst");
    expect(container.textContent).toMatch(/Udkast — ikke sendt/);

    fireEvent.click(getByText("Den live version"));
    expect(container.querySelector(".preview__body")?.textContent).toContain("[DEMO] Tekst om");
    expect(container.textContent).toMatch(/Preview.*Live · v1/);
  });

  it("tæller tegn i en SMS-preview", () => {
    const smsType = NOTIFICATION_TYPES.find((t) => t.key === "meeting-reminder")!;
    const smsVersion = version({ typeKey: smsType.key, channel: "sms", subject: null, body: "[DEMO] kort" });
    const channels = groupByChannel([smsVersion], ["sms"]).map((state) => ({ label: "SMS", state }));
    const { container } = render(
      <TemplateEditor
        typeKey={smsType.key}
        channels={channels}
        variables={smsType.variables}
        examples={PREVIEW_EXAMPLES}
        actions={{ save: vi.fn(), publish: vi.fn(), discard: vi.fn() }}
      />,
    );
    expect(container.querySelector(".preview__meta")?.textContent).toBe("11 tegn");
    expect(container.querySelector("#emne-sms")).toBeNull();
  });

  it("indsætter en variabel i teksten ved at klikke på dens chip", () => {
    const { getByLabelText, getByText } = setup([live]);
    const textarea = getByLabelText("Tekst") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "AB" } });
    textarea.setSelectionRange(1, 1);
    fireEvent.click(getByText("{{board_navn}}"));
    expect(textarea.value).toBe("A{{board_navn}}B");
  });

  it("indsætter i emnet når emnefeltet sidst havde fokus", () => {
    const { getByLabelText, getByText } = setup([live]);
    const subject = getByLabelText("Emne") as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "" } });
    fireEvent.focus(subject);
    fireEvent.click(getByText("{{aendring}}"));
    expect(subject.value).toBe("{{aendring}}");
  });
});

describe("TemplateEditor — handlinger", () => {
  it("Gem udkast kalder save-actionen med typen, kanalen og teksten, og viser kvitteringen", async () => {
    const { actions, getByText, getByLabelText, container } = setup([live]);
    fireEvent.change(getByLabelText("Tekst"), { target: { value: "[DEMO] Ny" } });
    await act(async () => {
      fireEvent.click(getByText("Gem udkast"));
    });
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    const formData = (vi.mocked(actions.save).mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(formData.get("type_key")).toBe("meeting-changed");
    expect(formData.get("channel")).toBe("email");
    expect(formData.get("body")).toBe("[DEMO] Ny");
    expect(actions.publish).not.toHaveBeenCalled();
    await waitFor(() => expect(container.textContent).toMatch(/Udkast gemt\./));
  });

  it("Publicér kræver en bekræftelse der siger at teksten bliver LIVE — og kan fortrydes", async () => {
    const { actions, getByText, queryByText, container } = setup([live]);
    fireEvent.click(getByText("Publicér…"));
    expect(container.textContent).toMatch(/bliver LIVE for alle fremtidige udsendelser/);
    expect(container.textContent).toMatch(/Den nuværende live version \(v1\) arkiveres/);
    expect(actions.publish).not.toHaveBeenCalled();

    fireEvent.click(getByText("Annullér"));
    expect(queryByText("Bekræft: gør live")).toBeNull();
    expect(actions.publish).not.toHaveBeenCalled();
  });

  it("Bekræft: gør live kalder publish-actionen — ikke save", async () => {
    const { actions, getByText } = setup([live]);
    fireEvent.click(getByText("Publicér…"));
    await act(async () => {
      fireEvent.click(getByText("Bekræft: gør live"));
    });
    await waitFor(() => expect(actions.publish).toHaveBeenCalledTimes(1));
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("Forkast udkast findes kun når der er et udkast, og nulstiller felterne til live", async () => {
    const without = setup([live]);
    expect(without.queryByText("Forkast udkast")).toBeNull();
    without.unmount();

    const { actions, getByText, getByLabelText } = setup([live, otherDraft]);
    expect((getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("[DEMO] Ny tekst");
    await act(async () => {
      fireEvent.click(getByText("Forkast udkast"));
    });
    await waitFor(() => expect(actions.discard).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("[DEMO] Tekst om {{board_navn}}"),
    );
  });

  it("viser fejlen fra actionen", async () => {
    const { getByText, container } = setup([live], {
      save: vi.fn(async () => ({ error: "Brødteksten må ikke være tom." })),
    });
    await act(async () => {
      fireEvent.click(getByText("Gem udkast"));
    });
    await waitFor(() => expect(container.querySelector("[role=alert]")?.textContent).toMatch(/må ikke være tom/));
  });

  it("'Indlæs i editor' fylder felterne ud fra en tidligere version uden at gemme", () => {
    const archived = version({ id: "v0", version: 1, status: "arkiveret", body: "[DEMO] Gammel tekst" });
    const newer = version({ id: "v9", version: 2, status: "live", body: "[DEMO] Nyere tekst" });
    const { getAllByText, getByLabelText, actions } = setup([newer, archived]);
    fireEvent.click(getAllByText("Indlæs i editor")[1]!);
    expect((getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("[DEMO] Gammel tekst");
    expect(actions.save).not.toHaveBeenCalled();
  });
});

describe("token-only styling", () => {
  it("editoren bruger kun token-klasser — ingen inline-styles", () => {
    const { container } = setup([live, otherDraft]);
    const styled = [...container.querySelectorAll("*")].filter((el) => el.getAttribute("style"));
    expect(styled).toHaveLength(0);
  });

  it("StatusBadge bærer sin tilstand som tekst og som klasse", () => {
    const { container } = render(<StatusBadge tone="live">Live · v3</StatusBadge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toBe("status-badge status-badge--live");
    expect(badge.textContent).toBe("Live · v3");
    expect(badge.getAttribute("style")).toBeNull();
  });
});

describe("NotificationOverview med skabeloner og log", () => {
  const state = getNotificationOverview({});

  it("viser pr. type og kanal om der er en live skabelon, og linker til editoren", () => {
    const templates = summarize([
      version({ typeKey: "meeting-changed", status: "live", version: 3 }),
      version({ id: "d", typeKey: "meeting-changed", version: 4, status: "udkast", publishedAt: null, body: "[DEMO] Andet" }),
    ]);
    const { container, getAllByText } = render(<NotificationOverview state={state} templates={templates} />);

    expect(container.querySelector(".status-badge--live")?.textContent).toBe("Live · v3");
    expect(container.querySelector(".status-badge--draft")?.textContent).toBe("Udkast afviger");
    // De øvrige kanaler/typer har ingen live skabelon.
    expect(container.querySelectorAll(".status-badge--none").length).toBe(5);
    const links = getAllByText("Redigér skabeloner");
    expect(links).toHaveLength(NOTIFICATION_TYPES.length);
    expect(links[1]?.getAttribute("href")).toBe("/admin/notifikationer/meeting-changed");
  });

  it("udelader skabelonkolonnen når skabeloner ikke er indlæst", () => {
    const { queryByText } = render(<NotificationOverview state={state} />);
    expect(queryByText("Skabelon")).toBeNull();
    expect(queryByText("Redigér skabeloner")).toBeNull();
  });

  it("viser udsendelseslogget med status, forsøg og fejl — og siger det når intet er sendt", () => {
    const empty = render(<NotificationOverview state={state} deliveries={[]} />);
    expect(empty.container.textContent).toMatch(/Der er ikke sendt eller forsøgt sendt noget endnu/);
    empty.unmount();

    const { container } = render(
      <NotificationOverview
        state={state}
        deliveries={[
          {
            id: "1",
            typeKey: "meeting-changed",
            channel: "email",
            status: "fejlet",
            attempt: 0,
            error: "ingen live skabelon",
            templateVersion: null,
            createdAt: "2026-10-10T08:00:00Z",
          },
          {
            id: "2",
            typeKey: "meeting-changed",
            channel: "email",
            status: "stub",
            attempt: 1,
            error: null,
            templateVersion: 2,
            createdAt: "2026-10-10T09:00:00Z",
          },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    const logRows = rows.filter((text) => /ingen live skabelon|Stub \(intet sendt\)/.test(text));
    expect(logRows[0]).toMatch(/Fejlet.*ingen live skabelon/);
    expect(logRows[1]).toMatch(/Stub \(intet sendt\).*v2/);
  });

  it("kalder en demo-kanal demo — ikke 'Sender'", () => {
    const demo = getNotificationOverview({ FLAG_DEMO: "true" });
    const { container, queryByText } = render(<NotificationOverview state={demo} />);
    expect(container.textContent).toMatch(/Demo — logger \[DEMO\]/);
    expect(queryByText("Sender")).toBeNull();
    expect(container.querySelector("p.empty")).not.toBeNull(); // demo tæller ikke som live
  });
});
