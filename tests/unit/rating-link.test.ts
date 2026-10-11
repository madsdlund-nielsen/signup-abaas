import { describe, expect, it } from "vitest";

import { isGateExempt } from "@/server/gate";
import {
  expiryFrom,
  formatRatingToken,
  linkState,
  parseRatingToken,
  RATING_LINK_TTL_DAYS,
  readRatingLinkSecret,
  signaturePayload,
  signRatingLink,
  verifyAgainstNothing,
  verifyRatingSignature,
  type SignedLinkFields,
} from "@/server/ratings/link";
import { parseScore } from "@/server/ratings/score";

/**
 * Token-laget til signerede rating-engangslinks (B-21, ADR 0060). Det er den del af en auth-fri
 * skrivevej der afgør om en fremmed kan forfalske et link — derfor testes både den lykkelige sti
 * og hver måde et token kan være forkert på. Alle id'er og hemmeligheder er syntetiske.
 */
const SECRET = "test-secret-test-secret-test-secret-0001";
const OTHER_SECRET = "andet-secret-andet-secret-andet-secret-02";

const LINK: SignedLinkFields = {
  id: "11111111-2222-4333-8444-555555555555",
  meetingId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  rater: { kind: "user", userId: "00000000-0000-0000-0000-00000000000a" },
  expiresAt: "2026-10-24T08:00:00.000Z",
};

function signatureOf(token: string): string {
  return token.split(".")[1] as string;
}

describe("readRatingLinkSecret — fail-closed", () => {
  it("er null uden hemmelighed, med tom hemmelighed og med en for kort", () => {
    expect(readRatingLinkSecret({})).toBeNull();
    expect(readRatingLinkSecret({ RATING_LINK_SECRET: "" })).toBeNull();
    expect(readRatingLinkSecret({ RATING_LINK_SECRET: "   " })).toBeNull();
    expect(readRatingLinkSecret({ RATING_LINK_SECRET: "kort" })).toBeNull();
  });

  it("returnerer en hemmelighed der er lang nok (trimmet)", () => {
    expect(readRatingLinkSecret({ RATING_LINK_SECRET: `  ${SECRET}  ` })).toBe(SECRET);
  });
});

describe("signér og verificér", () => {
  it("et signeret link verificerer mod samme række og hemmelighed", () => {
    const signature = signRatingLink(SECRET, LINK);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyRatingSignature(SECRET, LINK, signature)).toBe(true);
  });

  it("signaturen er deterministisk — tokenet kan genskabes af rækken", () => {
    expect(signRatingLink(SECRET, LINK)).toBe(signRatingLink(SECRET, { ...LINK }));
  });

  it("FORKERT hemmelighed afvises", () => {
    const signature = signRatingLink(SECRET, LINK);
    expect(verifyRatingSignature(OTHER_SECRET, LINK, signature)).toBe(false);
  });

  it("MANIPULERET signatur afvises — ét tegn ændret", () => {
    const signature = signRatingLink(SECRET, LINK);
    const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
    expect(verifyRatingSignature(SECRET, LINK, flipped)).toBe(false);
  });

  it("afkortet, tom og ikke-hex signatur afvises uden at kaste", () => {
    const signature = signRatingLink(SECRET, LINK);
    expect(verifyRatingSignature(SECRET, LINK, signature.slice(0, 63))).toBe(false);
    expect(verifyRatingSignature(SECRET, LINK, "")).toBe(false);
    expect(verifyRatingSignature(SECRET, LINK, "z".repeat(64))).toBe(false);
  });

  it("signaturen er bundet til HVER af felterne — ændres et, holder tokenet op med at virke", () => {
    const signature = signRatingLink(SECRET, LINK);
    const tampered: SignedLinkFields[] = [
      { ...LINK, id: "11111111-2222-4333-8444-555555555556" },
      { ...LINK, meetingId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef" },
      { ...LINK, rater: { kind: "user", userId: "00000000-0000-0000-0000-00000000000b" } },
      // Samme UUID som profil i stedet for bruger: typen indgår i signaturen.
      { ...LINK, rater: { kind: "partner", partnerProfileId: "00000000-0000-0000-0000-00000000000a" } },
      { ...LINK, expiresAt: "2099-01-01T00:00:00.000Z" },
    ];
    for (const fields of tampered) {
      expect(verifyRatingSignature(SECRET, fields, signature), JSON.stringify(fields)).toBe(false);
    }
  });

  it("basens tekstformat for tidspunktet ændrer ikke signaturen (normaliseres til ISO)", () => {
    const signature = signRatingLink(SECRET, LINK);
    expect(verifyRatingSignature(SECRET, { ...LINK, expiresAt: "2026-10-24T10:00:00+02:00" }, signature)).toBe(true);
    expect(verifyRatingSignature(SECRET, { ...LINK, expiresAt: "2026-10-24 08:00:00+00" }, signature)).toBe(true);
  });

  it("et ugyldigt udløbstidspunkt kaster ved signering og afvises ved verifikation", () => {
    expect(() => signaturePayload({ ...LINK, expiresAt: "ikke en dato" })).toThrow();
    expect(verifyRatingSignature(SECRET, { ...LINK, expiresAt: "ikke en dato" }, "a".repeat(64))).toBe(false);
  });

  it("verifyAgainstNothing er altid false", () => {
    expect(verifyAgainstNothing(SECRET, signRatingLink(SECRET, LINK))).toBe(false);
  });
});

describe("token-format", () => {
  it("er <id uden bindestreger>.<signatur> — ingen møde-id og ingen persondata i klartekst", () => {
    const token = formatRatingToken(SECRET, LINK);
    expect(token).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(token).not.toContain("-");
    expect(token).not.toContain(LINK.meetingId.replaceAll("-", ""));
    expect(token).not.toContain("00000000000a");
  });

  it("parse genskaber id'et med bindestreger og afviser alt andet format", () => {
    const token = formatRatingToken(SECRET, LINK);
    expect(parseRatingToken(token)).toEqual({ id: LINK.id, signature: signatureOf(token) });
    // Store bogstaver i id'et er det samme id.
    expect(parseRatingToken(token.toUpperCase().replace(/\.[0-9A-F]+$/, `.${signatureOf(token)}`))?.id).toBe(LINK.id);

    for (const bad of [
      "",
      ".",
      "abc",
      `${LINK.id}.${signatureOf(token)}`, // id med bindestreger
      `${token}.ekstra`,
      token.slice(0, -1),
      `${token}0`,
      token.replace(".", ""),
      `${"g".repeat(32)}.${"0".repeat(64)}`,
      `${"0".repeat(32)}.${"G".repeat(64)}`,
    ]) {
      expect(parseRatingToken(bad), bad).toBeNull();
    }
  });
});

describe("linkState og levetid", () => {
  const NOW = new Date("2026-10-10T08:00:00.000Z");

  it("gyldigt før udløb, udløbet ved og efter udløb", () => {
    expect(linkState({ usedAt: null, expiresAt: "2026-10-10T08:00:01.000Z" }, NOW)).toBe("gyldig");
    expect(linkState({ usedAt: null, expiresAt: "2026-10-10T08:00:00.000Z" }, NOW)).toBe("udloebet");
    expect(linkState({ usedAt: null, expiresAt: "2026-10-09T08:00:00.000Z" }, NOW)).toBe("udloebet");
  });

  it("brugt vejer tungere end udløbet", () => {
    const usedAt = "2026-10-01T08:00:00.000Z";
    expect(linkState({ usedAt, expiresAt: "2026-10-09T08:00:00.000Z" }, NOW)).toBe("brugt");
    expect(linkState({ usedAt, expiresAt: "2026-10-20T08:00:00.000Z" }, NOW)).toBe("brugt");
  });

  it("udløbet regnes fra udstedelsen med den tekniske TTL (TODO(ejer): levetid)", () => {
    expect(expiryFrom(NOW).getTime() - NOW.getTime()).toBe(RATING_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(expiryFrom(NOW, 1).toISOString()).toBe("2026-10-11T08:00:00.000Z");
  });
});

describe("parseScore (delt med den indloggede vurdering)", () => {
  it("accepterer hele tal 1-5", () => {
    for (const n of [1, 2, 3, 4, 5]) expect(parseScore(String(n))).toBe(n);
  });
  it("afviser alt andet — også tom streng, som ellers ville blive til 0", () => {
    for (const bad of ["", " ", "0", "6", "-1", "2.5", "tre", "1e0x", "NaN"]) {
      expect(parseScore(bad), bad).toBeNull();
    }
  });
});

describe("adgangsportens undtagelse (isGateExempt)", () => {
  it("undtager kun /gate og ruter under /vurdering/", () => {
    expect(isGateExempt("/gate")).toBe(true);
    expect(isGateExempt("/vurdering/abc.def")).toBe(true);
  });

  it("lader ikke en præfiks-rute eller en anden rute slippe uden om porten", () => {
    for (const path of [
      "/",
      "/login",
      "/admin",
      "/moeder/abc",
      "/vurdering",
      "/vurderingfoo",
      "/vurderinger",
      "/admin/vurdering/abc",
      "/gate/andet",
    ]) {
      expect(isGateExempt(path), path).toBe(false);
    }
  });

  it("en sti med punktummer normaliseres af URL'en før den når proxyen", () => {
    // Proxyen får `request.nextUrl.pathname`, dvs. en URL-normaliseret sti.
    expect(isGateExempt(new URL("https://app.example.invalid/vurdering/x/../../admin").pathname)).toBe(false);
    expect(isGateExempt(new URL("https://app.example.invalid/vurdering/%2e%2e/admin").pathname)).toBe(false);
  });
});
