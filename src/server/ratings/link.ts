/**
 * Signerede engangslinks til rating (B-21, byggespec §8, ADR 0060) — token-laget. Rent: ingen
 * Supabase, ingen next/*. Det er den del af en AUTH-FRI skrivevej der afgør om en fremmed kan
 * forfalske et link, så den er holdt lille og fuldt testbar.
 *
 * Tokenet er `<id>.<signatur>`:
 *   - `id` er `rating_link.id` (UUID v4, 122 tilfældige bit) uden bindestreger — et opaque
 *     opslagsnøgle. Ingen persondata, intet møde-id, ingen rater i URL'en.
 *   - `signatur` er HMAC-SHA256 (hex, 256 bit) over RÆKKENS indhold: id, møde, rater og
 *     udløbstidspunkt. Signaturen genberegnes fra den række tokenet peger på og sammenlignes i
 *     konstant tid. Dermed binder den linket til præcis dét møde, den rater og dén udløbstid
 *     rækken har — ændres en kolonne i basen, holder det gamle token op med at virke.
 *
 * At gætte et token kræver at forfalske signaturen, dvs. kende `RATING_LINK_SECRET`: 2^256, ikke
 * 2^122. Der er derfor ingen rate-limit (der er ingen infrastruktur til det, jf. ADR 0060) og
 * ingen brug for en — hvert forsøg har samme ubetydelige chance, og et forkert forsøg skriver
 * intet.
 *
 * FAIL-CLOSED: uden en hemmelighed der er lang nok, findes der intet token — hverken at udstede
 * eller at godkende. Der er aldrig en usigneret vej. Sammenligningen er konstant-tid
 * (`timingSafeEqual`), som gate-cookien (ADR 0020) — men node:crypto og ikke Web Crypto, fordi
 * dette kun kører på serveren (siden og actionen), aldrig på edge.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Hvor længe et link kan indløses efter udstedelsen. TEKNISK default, ikke en forretningsregel:
 * den hindrer at et glemt link i en gammel mail virker for evigt. Hvor længe ejerne faktisk skal
 * have til at svare, er ejerens beslutning.
 * TODO(ejer): linkets levetid.
 */
export const RATING_LINK_TTL_DAYS = 14;

/** Mindste hemmelighed der tæller som sat. 32 tegn ≈ 128+ bit hvis den er genereret tilfældigt. */
const MIN_SECRET_LENGTH = 32;

const SIGNATURE_VERSION = "rating-link-v1";
const ID_HEX = /^[0-9a-f]{32}$/;
const SIGNATURE_HEX = /^[0-9a-f]{64}$/;

/** Hvem linket vurderer som. Præcis én — spejler `meeting_rating` (0015). */
export type LinkRater =
  | { kind: "user"; userId: string }
  | { kind: "partner"; partnerProfileId: string };

/** De felter af `rating_link` signaturen dækker. */
export interface SignedLinkFields {
  id: string;
  meetingId: string;
  rater: LinkRater;
  /** ISO-8601 — normaliseres her, så basens tekstformat ikke kan ændre signaturen. */
  expiresAt: string;
}

/** Hemmeligheden, eller `null` hvis funktionen er slået fra (ikke sat / for kort). */
export function readRatingLinkSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.RATING_LINK_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function canonicalExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Ugyldigt udløbstidspunkt.");
  return date.toISOString();
}

function raterPart(rater: LinkRater): string {
  return rater.kind === "user" ? `user:${rater.userId}` : `partner:${rater.partnerProfileId}`;
}

/** Den tekst signaturen beregnes over. Felterne er UUID'er og en ISO-dato — ingen `|` kan forekomme. */
export function signaturePayload(fields: SignedLinkFields): string {
  return [
    SIGNATURE_VERSION,
    fields.id,
    fields.meetingId,
    raterPart(fields.rater),
    canonicalExpiry(fields.expiresAt),
  ].join("|");
}

export function signRatingLink(secret: string, fields: SignedLinkFields): string {
  return createHmac("sha256", secret).update(signaturePayload(fields)).digest("hex");
}

/** Tokenet til et link: `<id uden bindestreger>.<signatur>`. */
export function formatRatingToken(secret: string, fields: SignedLinkFields): string {
  return `${fields.id.replaceAll("-", "")}.${signRatingLink(secret, fields)}`;
}

export interface ParsedToken {
  /** UUID med bindestreger — nøglen til opslaget i `rating_link`. */
  id: string;
  signature: string;
}

/** Strengt format; alt andet er `null` (og dermed "ugyldigt link" uden at sige hvorfor). */
export function parseRatingToken(token: string): ParsedToken | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, signature] = parts as [string, string];
  const hex = rawId.toLowerCase();
  if (!ID_HEX.test(hex) || !SIGNATURE_HEX.test(signature)) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { id, signature };
}

/** Konstant-tids-sammenligning af to hex-signaturer af samme (fastlagte) længde. */
function signaturesMatch(expected: string, given: string): boolean {
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given, "utf8"));
}

/** Passer den fremlagte signatur til rækken? Kaster aldrig; ugyldigt input er blot `false`. */
export function verifyRatingSignature(
  secret: string,
  fields: SignedLinkFields,
  givenSignature: string,
): boolean {
  try {
    return signaturesMatch(signRatingLink(secret, fields), givenSignature);
  } catch {
    return false;
  }
}

/**
 * Bruges når tokenets id slet ikke findes: samme arbejde som en rigtig verifikation, mod en
 * fast række, så et "findes ikke" ikke er mærkbart hurtigere end et "forkert signatur".
 * Resultatet er altid `false`.
 */
export function verifyAgainstNothing(secret: string, givenSignature: string): false {
  signaturesMatch(
    signRatingLink(secret, {
      id: "00000000-0000-0000-0000-000000000000",
      meetingId: "00000000-0000-0000-0000-000000000000",
      rater: { kind: "user", userId: "00000000-0000-0000-0000-000000000000" },
      expiresAt: "2000-01-01T00:00:00.000Z",
    }),
    givenSignature,
  );
  return false;
}

export type LinkState = "gyldig" | "brugt" | "udloebet";

/**
 * Hvor står linket? Kun til visning — basen er den endelige dommer (`redeem_rating_link`
 * genprøver `used_at`/`expires_at` atomisk). `brugt` vejer tungere end `udloebet`: et brugt link
 * er "tak, vi har den", uanset hvornår det udløb.
 */
export function linkState(
  link: { usedAt: string | null; expiresAt: string },
  now: Date,
): LinkState {
  if (link.usedAt) return "brugt";
  return new Date(link.expiresAt).getTime() > now.getTime() ? "gyldig" : "udloebet";
}

export function expiryFrom(now: Date, ttlDays: number = RATING_LINK_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
