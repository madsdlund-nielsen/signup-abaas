/**
 * Rating-linkenes servicelag (B-21, ADR 0060): udstede, slå op og indløse. Pure funktioner over
 * `RatingLinkDeps` (lager + hemmelighed + ur), så alle tre kan testes uden database, og så siden,
 * actionen og notifikationsmotoren deler præcis samme regler.
 *
 * Den auth-frie vej har ét forsvar pr. trin, og de er uafhængige:
 *   1. SIGNATUREN (`./link`): et token uden gyldig HMAC over rækken afvises, før der skrives.
 *   2. ENGANGSBRUGEN (`redeem_rating_link`, 0023): basen afgør atomisk om linket stadig er
 *      ubrugt og ikke udløbet, og gemmer vurderingen i samme transaktion.
 *   3. UNIKHEDEN på `meeting_rating`: også en gentagelse der slap forbi 2) kan højst opdatere
 *      den ene række, aldrig hobe op.
 *
 * Intet svar røber mere end modtageren allerede ved. Ukendt id, forkert signatur, forkert
 * format, ikke-afholdt møde og "ingen hemmelighed konfigureret" giver ALLE det samme udfald
 * (`ugyldigt`) — ingen orakel for om et id findes. Først når signaturen er gyldig, dvs. når
 * den der spørger beviseligt har fået linket udleveret, skelnes der mellem brugt og udløbet.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import {
  expiryFrom,
  formatRatingToken,
  linkState,
  parseRatingToken,
  readRatingLinkSecret,
  verifyAgainstNothing,
  verifyRatingSignature,
  type LinkRater,
} from "./link";
import { createSupabaseRatingLinkStore, type RatingLinkRecord, type RatingLinkStore } from "./link-store";
import { parseScore, RATING_MAX, RATING_MIN } from "./score";

export interface RatingLinkDeps {
  store: RatingLinkStore;
  /** `null` = funktionen er slået fra: intet kan udstedes, intet kan indløses. */
  secret: string | null;
  now: () => Date;
}

/** Produktions-wiring. `null` hvis Supabase ikke er konfigureret (kontofri CI/dev). */
export function createRatingLinkDeps(
  env: Record<string, string | undefined> = process.env,
): RatingLinkDeps | null {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;
  return {
    store: createSupabaseRatingLinkStore(createServiceSupabase(config)),
    secret: readRatingLinkSecret(env),
    now: () => new Date(),
  };
}

/** Samme tekst for "ugyldigt", "findes ikke" og "slået fra" — ingen orakel (ADR 0060). */
export const INVALID_LINK_MESSAGE = "Linket kan ikke bruges. Log ind for at vurdere mødet i stedet.";

/** Kommentarens loft på den auth-frie vej. Teknisk værn mod misbrug, ikke en forretningsregel. */
export const LINK_COMMENT_MAX = 2000;

// ---------------------------------------------------------------------------------------------
// Udstede
// ---------------------------------------------------------------------------------------------

export interface IssuedLink {
  token: string;
  /** Stien i appen: `/vurdering/<token>`. Kalderen gør den absolut med appens URL. */
  path: string;
}

/**
 * Udsted (eller genfind) linket til én rater på ét møde. `null` betyder "intet link" — kalderen
 * falder tilbage til det loginbeskyttede link; det er aldrig en usigneret genvej:
 *   - ingen hemmelighed konfigureret,
 *   - det eksisterende link er allerede brugt eller udløbet.
 */
export async function issueRatingLink(
  deps: RatingLinkDeps,
  input: { meetingId: string; rater: LinkRater },
): Promise<IssuedLink | null> {
  if (!deps.secret) return null;
  const now = deps.now();
  const record = await deps.store.getOrCreate({
    meetingId: input.meetingId,
    rater: input.rater,
    expiresAt: expiryFrom(now),
  });
  if (linkState(record, now) !== "gyldig") return null;

  const token = formatRatingToken(deps.secret, record);
  return { token, path: `/vurdering/${token}` };
}

// ---------------------------------------------------------------------------------------------
// Slå op
// ---------------------------------------------------------------------------------------------

export type LinkLookup =
  /** Intet at vise: ukendt, forfalsket, forkert format, ikke afholdt eller funktionen er slået fra. */
  | { status: "ugyldigt" }
  | { status: "brugt" }
  | { status: "udloebet" }
  | { status: "gyldig"; id: string; meeting: { startsAt: string; boardName: string } };

async function resolve(deps: RatingLinkDeps, token: string): Promise<LinkLookup> {
  const secret = deps.secret;
  if (!secret) return { status: "ugyldigt" };

  const parsed = parseRatingToken(token);
  if (!parsed) return { status: "ugyldigt" };

  const record: RatingLinkRecord | null = await deps.store.find(parsed.id);
  if (!record) {
    verifyAgainstNothing(secret, parsed.signature);
    return { status: "ugyldigt" };
  }
  if (!verifyRatingSignature(secret, record, parsed.signature)) return { status: "ugyldigt" };

  // Signaturen er gyldig: modtageren har fået linket. Et møde der ikke (længere) er afholdt,
  // kan ikke vurderes — og det er ikke et svar vi lader være anderledes end "ugyldigt".
  if (!record.meeting || record.meeting.status !== "afholdt") return { status: "ugyldigt" };

  const state = linkState(record, deps.now());
  if (state === "brugt") return { status: "brugt" };
  if (state === "udloebet") return { status: "udloebet" };
  return {
    status: "gyldig",
    id: record.id,
    meeting: { startsAt: record.meeting.startsAt, boardName: record.meeting.boardName },
  };
}

export function lookupRatingLink(deps: RatingLinkDeps, token: string): Promise<LinkLookup> {
  return resolve(deps, token);
}

// ---------------------------------------------------------------------------------------------
// Indløse
// ---------------------------------------------------------------------------------------------

export type RedeemResult =
  | { status: "gemt" }
  | { status: "ugyldigt" | "brugt" | "udloebet" }
  /** Linket er i orden, men indholdet ikke — intet er brændt, brugeren kan rette og prøve igen. */
  | { status: "ugyldigt-input"; message: string };

export async function redeemRatingLinkToken(
  deps: RatingLinkDeps,
  token: string,
  input: { score: string; comment: string },
): Promise<RedeemResult> {
  const lookup = await resolve(deps, token);
  if (lookup.status !== "gyldig") return { status: lookup.status };

  // Indholdet valideres EFTER signaturen men FØR indløsningen: en forkert score brænder ikke linket.
  const score = parseScore(input.score);
  if (score === null) {
    return {
      status: "ugyldigt-input",
      message: `Vurderingen skal være et helt tal mellem ${RATING_MIN} og ${RATING_MAX}.`,
    };
  }
  const comment = input.comment.trim();
  if (comment.length > LINK_COMMENT_MAX) {
    return { status: "ugyldigt-input", message: `Kommentaren må højst være ${LINK_COMMENT_MAX} tegn.` };
  }

  const ratingId = await deps.store.redeem(lookup.id, score, comment.length > 0 ? comment : null);
  if (ratingId) return { status: "gemt" };

  // Basen afviste: nogen nåede først, linket udløb i mellemtiden, eller berettigelsen er væk.
  // Slå op igen for at give det ærlige svar (signaturen er allerede bevist).
  const after = await resolve(deps, token);
  return { status: after.status === "gyldig" ? "ugyldigt" : after.status };
}
