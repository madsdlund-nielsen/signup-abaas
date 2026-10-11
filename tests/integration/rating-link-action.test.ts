import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatRatingToken } from "@/server/ratings/link";
import { INVALID_LINK_MESSAGE, type RatingLinkDeps } from "@/server/ratings/link-service";
import { MemoryRatingLinkStore } from "./support/rating-link-fakes";

/**
 * Server action'en bag /vurdering/[token] (B-21, ADR 0060): limningen mellem formularen og
 * servicen. Vi mocker kun to ting — wiring'en til Supabase (`createRatingLinkDeps`) og
 * `redirect`, som i Next kaster en særlig undtagelse — så alt andet kører som i produktion.
 */
const SECRET = "test-secret-test-secret-test-secret-0001";
const OWNER = "00000000-0000-0000-0000-00000000000a";
const MEETING = "00000000-0000-0000-0000-0000000f0002";

const state = vi.hoisted(() => ({ deps: null as RatingLinkDeps | null, throwOnCreate: false }));

vi.mock("@/server/ratings/link-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ratings/link-service")>();
  return {
    ...original,
    createRatingLinkDeps: () => {
      if (state.throwOnCreate) throw new Error("basen sagde anna@firma.dk er nede");
      return state.deps;
    },
  };
});

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

// Importeres EFTER mocks er erklæret (vi.mock hejses, men dynamisk import gør afhængigheden eksplicit).
const { redeemRatingLink } = await import("@/server/ratings/link-actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

let clock: { now: Date };
let store: MemoryRatingLinkStore;
let token: string;

beforeEach(() => {
  clock = { now: new Date("2026-10-10T08:00:00.000Z") };
  store = new MemoryRatingLinkStore(clock);
  state.deps = { store, secret: SECRET, now: () => clock.now };
  state.throwOnCreate = false;
  const record = store.seed({ rater: { kind: "user", userId: OWNER }, meetingId: MEETING });
  token = formatRatingToken(SECRET, record);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redeemRatingLink (server action)", () => {
  it("gemmer vurderingen og sender brugeren tilbage til siden, som nu siger tak", async () => {
    await expect(redeemRatingLink({}, form({ token, score: "5", comment: "Godt" }))).rejects.toMatchObject({
      to: `/vurdering/${token}`,
    });
    expect(store.ratings.size).toBe(1);
  });

  it("andet forsøg med samme token returnerer en rolig besked og gemmer intet nyt", async () => {
    await expect(redeemRatingLink({}, form({ token, score: "5" }))).rejects.toBeInstanceOf(RedirectSignal);
    const second = await redeemRatingLink({}, form({ token, score: "1" }));
    expect(second.error).toMatch(/allerede brugt/);
    expect(store.ratings.size).toBe(1);
    expect([...store.ratings.values()][0]?.score).toBe(5);
  });

  it("en ugyldig score giver en fejl men brænder ikke linket", async () => {
    const bad = await redeemRatingLink({}, form({ token, score: "9" }));
    expect(bad.error).toMatch(/mellem 1 og 5/);
    await expect(redeemRatingLink({}, form({ token, score: "4" }))).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("et forfalsket token og et manglende token giver ÉN og samme besked", async () => {
    const forged = await redeemRatingLink({}, form({ token: `${"0".repeat(32)}.${"0".repeat(64)}`, score: "5" }));
    const missing = await redeemRatingLink({}, form({ score: "5" }));
    expect(forged.error).toBe(INVALID_LINK_MESSAGE);
    expect(missing.error).toBe(INVALID_LINK_MESSAGE);
    expect(store.ratings.size).toBe(0);
  });

  it("uden hemmelighed fejler den lukket", async () => {
    state.deps = { store, secret: null, now: () => clock.now };
    const result = await redeemRatingLink({}, form({ token, score: "5" }));
    expect(result.error).toBe(INVALID_LINK_MESSAGE);
    expect(store.ratings.size).toBe(0);
  });

  it("uden Supabase-konfiguration fejler den lukket", async () => {
    state.deps = null;
    expect((await redeemRatingLink({}, form({ token, score: "5" }))).error).toBe(INVALID_LINK_MESSAGE);
  });

  it("et udløbet link henviser til login", async () => {
    clock.now = new Date("2030-01-01T00:00:00Z");
    const result = await redeemRatingLink({}, form({ token, score: "5" }));
    expect(result.error).toMatch(/udløbet/);
    expect(store.ratings.size).toBe(0);
  });

  it("en infrastrukturfejl giver en generisk besked og lækker hverken token eller persondata i loggen", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.throwOnCreate = true;
    const result = await redeemRatingLink({}, form({ token, score: "5" }));

    expect(result.error).toMatch(/Prøv igen/);
    expect(result.error).not.toContain("firma.dk");
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("indløsning af rating-link fejlede");
    expect(logged).not.toContain("anna@firma.dk");
    expect(logged).not.toContain(token);
  });
});
