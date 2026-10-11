import { describe, expect, it } from "vitest";

import { OrdbogenError } from "@/lib/ordbogen/client";
import { resolveSummaryState, type SummaryRow } from "@/server/summaries";
import {
  isStaleClaim,
  MAX_ATTEMPTS,
  failureCode,
  STALE_CLAIM_MS,
  statusAfterFailure,
  SUMMARY_STATUSES,
} from "@/server/summaries/status";

/** Opsummeringens livscyklus (B-45, ADR 0059) — ren logik, ingen database. */
describe("statusAfterFailure — forsøg før opgivelse", () => {
  it("prøver igen indtil MAX_ATTEMPTS er brugt, og opgiver så", () => {
    for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts++) {
      expect(statusAfterFailure(attempts)).toBe("afventer");
    }
    expect(statusAfterFailure(MAX_ATTEMPTS)).toBe("fejlet");
    expect(statusAfterFailure(MAX_ATTEMPTS + 1)).toBe("fejlet");
  });
});

describe("isStaleClaim — en død kørsel frigiver sin lås", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("en frisk lås er ikke forældet", () => {
    expect(isStaleClaim(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(false);
    expect(isStaleClaim(new Date(now.getTime() - STALE_CLAIM_MS + 1).toISOString(), now)).toBe(false);
  });

  it("en lås der er mindst STALE_CLAIM_MS gammel er forældet", () => {
    expect(isStaleClaim(new Date(now.getTime() - STALE_CLAIM_MS).toISOString(), now)).toBe(true);
    expect(isStaleClaim("2026-01-01T00:00:00Z", now)).toBe(true);
  });
});

describe("failureCode — aldrig fejlens besked", () => {
  it("giver kun operation og HTTP-status for en leverandørfejl", () => {
    const e = new OrdbogenError("summarizeMeeting", "Ejeren sagde: hemmeligt indhold", 502);
    expect(failureCode(e)).toBe("OrdbogenError:summarizeMeeting:HTTP502");
    expect(failureCode(e)).not.toContain("hemmeligt");
  });

  it("giver fejlklassen for andre fejl og en fast kode for ikke-fejl", () => {
    expect(failureCode(new TypeError("indhold: persondata"))).toBe("TypeError");
    expect(failureCode("tekst med indhold")).toBe("UkendtFejl");
  });
});

describe("resolveSummaryState — hvad siden viser for den gemte række", () => {
  const row = (over: Partial<SummaryRow>): SummaryRow => ({
    status: "afventer",
    summary: null,
    action_items: [],
    provider: null,
    ...over,
  });

  it("klar → resumé og handlingspunkter; kilden følger leverandøren", () => {
    const live = resolveSummaryState(
      row({ status: "klar", summary: "Resumé", action_items: ["Et", 2, "To"], provider: "ordbogen" }),
      true,
    );
    expect(live).toEqual({ kind: "ready", source: "live", summary: "Resumé", actionItems: ["Et", "To"] });

    const demo = resolveSummaryState(row({ status: "klar", summary: "[DEMO] x", provider: "demo" }), true);
    expect(demo).toMatchObject({ kind: "ready", source: "demo" });
  });

  it("afventer og genereres er 'på vej'", () => {
    expect(resolveSummaryState(row({ status: "afventer" }), true)).toEqual({ kind: "pending" });
    expect(resolveSummaryState(row({ status: "genereres" }), true)).toEqual({ kind: "pending" });
    expect(resolveSummaryState(null, true)).toEqual({ kind: "pending" });
  });

  it("mangler_samtykke, mangler_optagelse og fejlet har hver sin tilstand — uanset konfiguration", () => {
    for (const configured of [true, false]) {
      expect(resolveSummaryState(row({ status: "mangler_samtykke" }), configured)).toEqual({ kind: "missing_consent" });
      expect(resolveSummaryState(row({ status: "mangler_optagelse" }), configured)).toEqual({
        kind: "missing_recording",
      });
      expect(resolveSummaryState(row({ status: "fejlet" }), configured)).toEqual({ kind: "failed" });
    }
  });

  it("er et synligt hul — ikke 'på vej' — når AI-opfølgning ikke er konfigureret", () => {
    const state = resolveSummaryState(null, false);
    expect(state.kind).toBe("unavailable");
    if (state.kind === "unavailable") expect(state.reason).toMatch(/ikke konfigureret/);
    expect(resolveSummaryState(row({ status: "afventer" }), false).kind).toBe("unavailable");
  });

  it("en 'klar' række uden tekst er ikke et resumé", () => {
    expect(resolveSummaryState(row({ status: "klar", summary: null }), true)).toEqual({ kind: "pending" });
  });

  it("dækker alle statusser i enummet", () => {
    for (const status of SUMMARY_STATUSES) {
      expect(() => resolveSummaryState(row({ status, summary: "x" }), true)).not.toThrow();
    }
  });
});
