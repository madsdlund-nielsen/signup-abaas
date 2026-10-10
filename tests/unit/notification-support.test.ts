import { describe, expect, it } from "vitest";
import { scrubError, scrubPii, REDACTED } from "@/server/notifications/scrub";
import { appLink, formatMeetingTime } from "@/server/notifications/format";
import {
  channelBadge,
  differsFromLive,
  groupByChannel,
  summarize,
  type TemplateVersion,
} from "@/server/notifications/template-state";

function version(overrides: Partial<TemplateVersion>): TemplateVersion {
  return {
    id: "t",
    typeKey: "meeting-reminder",
    channel: "email",
    version: 1,
    status: "udkast",
    subject: "[DEMO] Emne",
    body: "[DEMO] Tekst",
    publishedAt: null,
    createdAt: "2000-01-01T00:00:00Z",
    updatedAt: "2000-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scrubPii — ingen persondata i loggen", () => {
  it("fjerner e-mailadresser, også når leverandøren citerer dem", () => {
    const text = scrubPii("The 'to' address anna.test+x@firma-demo.example.invalid is invalid");
    expect(text).not.toContain("@");
    expect(text).toContain(REDACTED);
  });

  it("fjerner telefonnumre med landekode og lange taltryk", () => {
    expect(scrubPii("Ugyldigt nummer +45 12 34 56 78")).not.toMatch(/\d{2} \d{2}/);
    expect(scrubPii("nummer 4512345678 afvist")).not.toContain("4512345678");
  });

  it("lader datoer og uuid'er være", () => {
    const text = scrubPii("2026-10-10 kl. 10:00 møde 00000000-0000-0000-0000-0000000f0001");
    expect(text).toContain("2026-10-10");
    expect(text).toContain("0000000f0001");
  });

  it("kapper lange tekster", () => {
    expect(scrubPii("x".repeat(1000))).toHaveLength(300);
  });

  it("scrubError tager kun beskeden — ikke stak eller egenskaber", () => {
    const error = Object.assign(new Error("fejl for a@b.invalid"), { recipient: "c@d.invalid" });
    const text = scrubError(error);
    expect(text).toBe(`fejl for ${REDACTED}`);
    expect(scrubError("streng a@b.invalid")).not.toContain("@");
  });
});

describe("formatMeetingTime — altid dansk tid", () => {
  it("viser sommertid (UTC+2) og vintertid (UTC+1) korrekt", () => {
    // 10:00 UTC i oktober (sommertid) = 12.00 dansk tid.
    expect(formatMeetingTime("2026-10-13T10:00:00Z")).toBe("tirsdag den 13. oktober 2026 kl. 12.00");
    // 10:00 UTC i december (vintertid) = 11.00 dansk tid.
    expect(formatMeetingTime("2026-12-15T10:00:00Z")).toBe("tirsdag den 15. december 2026 kl. 11.00");
  });

  it("afviser et ugyldigt tidspunkt højlydt", () => {
    expect(() => formatMeetingTime("ikke en dato")).toThrow(/Ugyldigt tidspunkt/);
  });
});

describe("appLink", () => {
  it("bygger en absolut adresse og tåler skråstreger", () => {
    expect(appLink("/moeder/1", "https://app.example.invalid/")).toBe("https://app.example.invalid/moeder/1");
    expect(appLink("moeder/1", "https://app.example.invalid")).toBe("https://app.example.invalid/moeder/1");
  });

  it("giver undefined — ikke en relativ adresse — når appens URL ikke er sat", () => {
    expect(appLink("/moeder/1", undefined)).toBeUndefined();
    expect(appLink("/moeder/1", "")).toBeUndefined();
  });
});

describe("skabelon-tilstand (live vs. udkast)", () => {
  it("differsFromLive: uden live er ethvert udkast anderledes; ens tekst er ikke afvigende", () => {
    const live = version({ status: "live", publishedAt: "2000-01-02T00:00:00Z" });
    expect(differsFromLive({ subject: "[DEMO] Emne", body: "[DEMO] Tekst" }, null)).toBe(true);
    expect(differsFromLive({ subject: "[DEMO] Emne", body: "[DEMO] Tekst" }, live)).toBe(false);
    expect(differsFromLive({ subject: "[DEMO] Emne", body: "[DEMO] Ændret" }, live)).toBe(true);
    expect(differsFromLive({ subject: "[DEMO] Andet", body: "[DEMO] Tekst" }, live)).toBe(true);
  });

  it("SMS-emne null sammenlignes som tomt", () => {
    expect(differsFromLive({ subject: null, body: "a" }, { subject: null, body: "a" })).toBe(false);
  });

  it("groupByChannel finder live og udkast, nyeste version først", () => {
    const [state] = groupByChannel(
      [
        version({ id: "a", version: 1, status: "arkiveret", publishedAt: "2000-01-02T00:00:00Z" }),
        version({ id: "b", version: 2, status: "live", publishedAt: "2000-01-03T00:00:00Z" }),
        version({ id: "c", version: 3, status: "udkast" }),
        version({ id: "d", version: 1, status: "live", channel: "sms", subject: null }),
      ],
      ["email"],
    );
    expect(state?.live?.id).toBe("b");
    expect(state?.draft?.id).toBe("c");
    expect(state?.history.map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("kanaler uden versioner får en tom tilstand", () => {
    const [state] = groupByChannel([], ["sms"]);
    expect(state).toMatchObject({ channel: "sms", live: null, draft: null, history: [] });
  });

  it("channelBadge: ingen live / live / live med afvigende udkast", () => {
    const live = version({ id: "l", version: 1, status: "live", publishedAt: "2000-01-02T00:00:00Z" });
    const sameDraft = version({ id: "d", version: 2, status: "udkast" });
    const otherDraft = version({ id: "d", version: 2, status: "udkast", body: "[DEMO] Anden" });

    expect(channelBadge({ channel: "email", live: null, draft: sameDraft, history: [sameDraft] })).toBe(
      "ingen-live",
    );
    expect(channelBadge({ channel: "email", live, draft: null, history: [live] })).toBe("live");
    expect(channelBadge({ channel: "email", live, draft: sameDraft, history: [sameDraft, live] })).toBe(
      "live",
    );
    expect(channelBadge({ channel: "email", live, draft: otherDraft, history: [otherDraft, live] })).toBe(
      "live-med-udkast",
    );
  });

  it("summarize samler pr. type og kanal", () => {
    const summary = summarize([
      version({ id: "a", typeKey: "meeting-reminder", status: "live", publishedAt: "2000-01-02T00:00:00Z" }),
      version({ id: "b", typeKey: "rating-request", channel: "sms", subject: null }),
    ]);
    expect(summary["meeting-reminder"]?.email?.live?.id).toBe("a");
    expect(summary["rating-request"]?.sms?.draft?.id).toBe("b");
    expect(summary["rating-request"]?.email).toBeUndefined();
  });
});
