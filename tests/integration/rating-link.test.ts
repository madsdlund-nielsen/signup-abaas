import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatRatingToken, parseRatingToken, signRatingLink } from "@/server/ratings/link";
import {
  issueRatingLink,
  LINK_COMMENT_MAX,
  lookupRatingLink,
  redeemRatingLinkToken,
  type RatingLinkDeps,
} from "@/server/ratings/link-service";
import type { RatingLinkRecord } from "@/server/ratings/link-store";
import { MemoryRatingLinkStore } from "./support/rating-link-fakes";

/**
 * Servicelaget bag /vurdering/[token] (B-21, ADR 0060) mod en in-memory-store der spejler basens
 * regler. Testen vogter den auth-frie skrivevejs kontrakt: kun et gyldigt, ubrugt, ikke-udløbet
 * token gemmer en vurdering — og ALLE andre udfald gemmer intet og røber ikke hvorfor. Basens egne
 * garantier (atomicitet, RLS) testes mod rigtig Postgres i tests/db/rating-link-rls.test.ts.
 */
const SECRET = "test-secret-test-secret-test-secret-0001";
const OTHER_SECRET = "andet-secret-andet-secret-andet-secret-02";
const OWNER = "00000000-0000-0000-0000-00000000000a";
const MEETING = "00000000-0000-0000-0000-0000000f0002";
const NOW = new Date("2026-10-10T08:00:00.000Z");

let clock: { now: Date };
let store: MemoryRatingLinkStore;
let deps: RatingLinkDeps;

beforeEach(() => {
  clock = { now: NOW };
  store = new MemoryRatingLinkStore(clock);
  deps = { store, secret: SECRET, now: () => clock.now };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function issued(overrides: Partial<RatingLinkRecord> = {}) {
  const record = store.seed({ rater: { kind: "user", userId: OWNER }, meetingId: MEETING, ...overrides });
  return { record, token: formatRatingToken(SECRET, record) };
}

describe("issueRatingLink", () => {
  it("uden hemmelighed udstedes intet — og lageret røres ikke", async () => {
    const result = await issueRatingLink({ ...deps, secret: null }, { meetingId: MEETING, rater: { kind: "user", userId: OWNER } });
    expect(result).toBeNull();
    expect(store.links).toHaveLength(0);
  });

  it("udsteder et token der kan slås op, med udløb fra udstedelsen", async () => {
    const result = await issueRatingLink(deps, { meetingId: MEETING, rater: { kind: "user", userId: OWNER } });
    expect(result?.path).toBe(`/vurdering/${result?.token}`);
    expect(store.links).toHaveLength(1);
    expect(new Date(store.links[0]!.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(await lookupRatingLink(deps, result!.token)).toMatchObject({ status: "gyldig" });
  });

  it("er idempotent: samme token, én række — ingen opsamling ved gentagne kørsler", async () => {
    const input = { meetingId: MEETING, rater: { kind: "user", userId: OWNER } } as const;
    const first = await issueRatingLink(deps, input);
    const second = await issueRatingLink(deps, input);
    expect(second?.token).toBe(first?.token);
    expect(store.links).toHaveLength(1);
  });

  it("udsteder intet nyt til et link der allerede er brugt eller udløbet", async () => {
    const { record } = await issued();
    record.usedAt = NOW.toISOString();
    expect(await issueRatingLink(deps, { meetingId: MEETING, rater: record.rater })).toBeNull();

    record.usedAt = null;
    clock.now = new Date("2030-01-01T00:00:00Z");
    expect(await issueRatingLink(deps, { meetingId: MEETING, rater: record.rater })).toBeNull();
  });
});

describe("lookupRatingLink — ingen orakel", () => {
  it("gyldigt token viser kun mødets tidspunkt og boardnavn", async () => {
    const { token, record } = await issued();
    const result = await lookupRatingLink(deps, token);
    expect(result).toEqual({
      status: "gyldig",
      id: record.id,
      meeting: { startsAt: "2026-10-09T10:00:00.000Z", boardName: "[DEMO] Testboard" },
    });
  });

  it("ukendt id, forfalsket signatur, forkert format og ingen hemmelighed giver PRÆCIS det samme svar", async () => {
    const { token, record } = await issued();
    const forgedSignature = `${record.id.replaceAll("-", "")}.${"0".repeat(64)}`;
    const unknownId = `${"1".repeat(32)}.${signRatingLink(SECRET, { ...record, id: "11111111-1111-1111-1111-111111111111" })}`;
    const wrongSecret = formatRatingToken(OTHER_SECRET, record);

    const results = await Promise.all([
      lookupRatingLink(deps, forgedSignature),
      lookupRatingLink(deps, unknownId),
      lookupRatingLink(deps, wrongSecret),
      lookupRatingLink(deps, "ikke-et-token"),
      lookupRatingLink(deps, ""),
      lookupRatingLink({ ...deps, secret: null }, token),
    ]);
    for (const result of results) expect(result).toEqual({ status: "ugyldigt" });
  });

  it("et token bundet til en ANDEN række-identitet virker ikke (rækken ændret efter udstedelsen)", async () => {
    const { token, record } = await issued();
    record.rater = { kind: "user", userId: "00000000-0000-0000-0000-00000000000b" };
    expect(await lookupRatingLink(deps, token)).toEqual({ status: "ugyldigt" });
  });

  it("et token hvis udløb er ændret i rækken virker ikke (kan ikke forlænges via basen)", async () => {
    const { token, record } = await issued();
    record.expiresAt = "2099-01-01T00:00:00.000Z";
    expect(await lookupRatingLink(deps, token)).toEqual({ status: "ugyldigt" });
  });

  it("et møde der ikke er afholdt giver 'ugyldigt', ikke en særskilt besked", async () => {
    const { token } = await issued({ meeting: { startsAt: "2026-10-09T10:00:00.000Z", status: "aflyst", boardName: "x" } });
    expect(await lookupRatingLink(deps, token)).toEqual({ status: "ugyldigt" });
  });

  it("først når signaturen er gyldig skelnes der mellem udløbet og brugt", async () => {
    const expired = await issued({ expiresAt: "2026-10-01T00:00:00.000Z" });
    expect(await lookupRatingLink(deps, expired.token)).toEqual({ status: "udloebet" });

    const used = await issued({ meetingId: "00000000-0000-0000-0000-0000000f0003", usedAt: "2026-10-09T00:00:00.000Z" });
    expect(await lookupRatingLink(deps, used.token)).toEqual({ status: "brugt" });
  });

  it("opslaget indløser ALDRIG linket (en mailscanner der henter siden må ikke brænde det)", async () => {
    const { token, record } = await issued();
    await lookupRatingLink(deps, token);
    await lookupRatingLink(deps, token);
    expect(record.usedAt).toBeNull();
    expect(store.redeemCalls).toBe(0);
  });
});

describe("redeemRatingLinkToken", () => {
  it("gemmer vurderingen og bruger linket", async () => {
    const { token, record } = await issued();
    const result = await redeemRatingLinkToken(deps, token, { score: "4", comment: "  Godt møde  " });

    expect(result).toEqual({ status: "gemt" });
    expect(record.usedAt).toBe(NOW.toISOString());
    expect([...store.ratings.values()]).toEqual([
      { meetingId: MEETING, rater: { kind: "user", userId: OWNER }, score: 4, comment: "Godt møde" },
    ]);
  });

  it("en tom kommentar gemmes som null", async () => {
    const { token } = await issued();
    await redeemRatingLinkToken(deps, token, { score: "5", comment: "   " });
    expect([...store.ratings.values()][0]?.comment).toBeNull();
  });

  it("DOBBELTINDLØSNING giver kun én vurdering — den anden afvises som brugt", async () => {
    const { token } = await issued();
    const first = await redeemRatingLinkToken(deps, token, { score: "5", comment: "" });
    const second = await redeemRatingLinkToken(deps, token, { score: "1", comment: "overskriv" });

    expect(first).toEqual({ status: "gemt" });
    expect(second).toEqual({ status: "brugt" });
    expect(store.ratings.size).toBe(1);
    expect([...store.ratings.values()][0]?.score).toBe(5);
  });

  it("to SAMTIDIGE indløsninger giver kun én vurdering (basen afgør; den tabende får 'brugt')", async () => {
    const { token } = await issued();
    const results = await Promise.all([
      redeemRatingLinkToken(deps, token, { score: "5", comment: "" }),
      redeemRatingLinkToken(deps, token, { score: "2", comment: "" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["brugt", "gemt"]);
    expect(store.ratings.size).toBe(1);
    // Begge kald nåede til basen — det er dér engangsbrugen afgøres, ikke i opslaget.
    expect(store.redeemCalls).toBe(2);
  });

  it("et UDLØBET link afvises og gemmer intet", async () => {
    const { token } = await issued({ expiresAt: "2026-10-01T00:00:00.000Z" });
    expect(await redeemRatingLinkToken(deps, token, { score: "5", comment: "" })).toEqual({ status: "udloebet" });
    expect(store.ratings.size).toBe(0);
    expect(store.redeemCalls).toBe(0);
  });

  it("udløb MELLEM opslag og indløsning afvises af basen", async () => {
    const { token, record } = await issued({ expiresAt: "2026-10-10T08:00:00.500Z" });
    const original = store.redeem.bind(store);
    store.redeem = async (...args) => {
      clock.now = new Date("2026-10-10T08:00:01.000Z"); // sekundet efter opslaget
      return original(...args);
    };
    expect(await redeemRatingLinkToken(deps, token, { score: "5", comment: "" })).toEqual({ status: "udloebet" });
    expect(store.ratings.size).toBe(0);
    expect(record.usedAt).toBeNull();
  });

  it("UDEN hemmelighed afvises alt, og lageret røres ikke", async () => {
    const { token } = await issued();
    const result = await redeemRatingLinkToken({ ...deps, secret: null }, token, { score: "5", comment: "" });
    expect(result).toEqual({ status: "ugyldigt" });
    expect(store.ratings.size).toBe(0);
    expect(store.redeemCalls).toBe(0);
  });

  it("et forfalsket eller forkert signeret token når aldrig basen", async () => {
    const { record } = await issued();
    const forged = `${record.id.replaceAll("-", "")}.${"a".repeat(64)}`;
    const wrongSecret = formatRatingToken(OTHER_SECRET, record);
    for (const token of [forged, wrongSecret, "x", ""]) {
      expect(await redeemRatingLinkToken(deps, token, { score: "5", comment: "" })).toEqual({ status: "ugyldigt" });
    }
    expect(store.redeemCalls).toBe(0);
    expect(store.ratings.size).toBe(0);
  });

  it("en ugyldig score brænder IKKE linket — brugeren kan rette og prøve igen", async () => {
    const { token, record } = await issued();
    for (const score of ["", "0", "6", "tre", "2.5"]) {
      const result = await redeemRatingLinkToken(deps, token, { score, comment: "" });
      expect(result.status, score).toBe("ugyldigt-input");
    }
    expect(record.usedAt).toBeNull();
    expect(store.redeemCalls).toBe(0);
    expect(await redeemRatingLinkToken(deps, token, { score: "3", comment: "" })).toEqual({ status: "gemt" });
  });

  it("en for lang kommentar afvises uden at brænde linket", async () => {
    const { token, record } = await issued();
    const result = await redeemRatingLinkToken(deps, token, { score: "3", comment: "x".repeat(LINK_COMMENT_MAX + 1) });
    expect(result.status).toBe("ugyldigt-input");
    expect(record.usedAt).toBeNull();
    expect(await redeemRatingLinkToken(deps, token, { score: "3", comment: "x".repeat(LINK_COMMENT_MAX) })).toEqual({
      status: "gemt",
    });
  });

  it("en partner-rater gemmes som partnerens katalogpost, ikke som en bruger", async () => {
    const PROFILE = "00000000-0000-0000-0000-0000000e0001";
    const { token } = await issued({ rater: { kind: "partner", partnerProfileId: PROFILE } });
    await redeemRatingLinkToken(deps, token, { score: "4", comment: "" });
    expect([...store.ratings.values()][0]?.rater).toEqual({ kind: "partner", partnerProfileId: PROFILE });
  });

  it("tokenet kan ikke genbruges til et ANDET link (hver række har sit eget token)", async () => {
    const a = await issued();
    const b = await issued({ rater: { kind: "user", userId: "00000000-0000-0000-0000-00000000000b" } });
    await redeemRatingLinkToken(deps, a.token, { score: "5", comment: "" });
    expect(b.record.usedAt).toBeNull();
    expect(parseRatingToken(a.token)?.id).not.toBe(parseRatingToken(b.token)?.id);
  });
});
