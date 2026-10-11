/**
 * Mødenotifikationer (fase 4.5, ADR 0057): de fire udløsere der sender beskeder omkring et
 * møde — aflysning/flytning (hændelse), påmindelse og ratinganmodning (planlagt) og fejlet
 * betaling (hændelse, koblingspunktet ejes af betalingsskiven).
 *
 * Alt her er limning mellem møde-/board-data og motoren: find modtagerne, byg variablerne,
 * kald `sendNotification`. Selve idempotensen, retry'en og logningen bor i motoren.
 *
 * De PLANLAGTE udsendelser (`sendMeetingReminders`, `sendRatingRequests`) sender intet før
 * ejeren har fastsat tidspunktet: kataloget har `schedule: null`, og funktionerne svarer
 * `ikke-fastlagt`. TODO(ejer): udsendelsestidspunkt for påmindelse og ratinganmodning.
 */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readRatingLinkSecret, type LinkRater } from "@/server/ratings/link";
import { createSupabaseRatingLinkStore } from "@/server/ratings/link-store";
import { issueRatingLink, type RatingLinkDeps } from "@/server/ratings/link-service";

import { getNotificationType, type NotificationSchedule } from "./catalog";
import { createEngineDeps, sendNotification, type EngineDeps, type SendOutcome } from "./engine";
import { appLink, formatMeetingTime } from "./format";
import { scrubError } from "./scrub";
import type { VariableValues } from "./render";

// ---------------------------------------------------------------------------------------------
// Møde-kontekst
// ---------------------------------------------------------------------------------------------

export interface MeetingContext {
  meetingId: string;
  boardName: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
  ownerUserId: string;
  /** Boardets deltagende partnere der HAR et login. Partnere uden konto kan ikke nås. */
  partnerUserIds: string[];
  /**
   * Login-bruger → partnerens katalogpost, for de partnere hvis række bar et id. Bruges til at
   * udstede rating-linket (B-21), som vurderer SOM katalogposten (ADR 0021/0060).
   */
  partnerProfileIdByUserId: Record<string, string>;
}

interface MeetingRow {
  id: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  board: { name: string; owner_id: string } | Array<{ name: string; owner_id: string }> | null;
  meeting_partner: Array<{
    partner_profile:
      | { id?: string; app_user_id: string | null }
      | Array<{ id?: string; app_user_id: string | null }>
      | null;
  }> | null;
}

const MEETING_SELECT =
  "id, starts_at, duration_minutes, status, board(name, owner_id), meeting_partner(partner_profile(id, app_user_id))";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function toContext(row: MeetingRow): MeetingContext | null {
  // PostgREST to-one-embeds er objekter i praksis, men typeudledningen gætter array.
  const board = one(row.board);
  if (!board) return null;
  const profiles = (row.meeting_partner ?? []).map((participant) => one(participant.partner_profile));
  const partnerUserIds = profiles
    .map((profile) => profile?.app_user_id ?? null)
    .filter((id): id is string => Boolean(id));
  const partnerProfileIdByUserId: Record<string, string> = {};
  for (const profile of profiles) {
    if (profile?.app_user_id && profile.id) partnerProfileIdByUserId[profile.app_user_id] = profile.id;
  }
  return {
    meetingId: row.id,
    boardName: board.name,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    ownerUserId: board.owner_id,
    partnerUserIds: [...new Set(partnerUserIds)],
    partnerProfileIdByUserId,
  };
}

export async function loadMeetingContext(
  service: SupabaseClient,
  meetingId: string,
): Promise<MeetingContext | null> {
  const { data, error } = await service.from("meeting").select(MEETING_SELECT).eq("id", meetingId).maybeSingle();
  if (error) throw new Error(`Kunne ikke læse mødet: ${error.message}`);
  return data ? toContext(data as unknown as MeetingRow) : null;
}

function appUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.NEXT_PUBLIC_APP_URL || undefined;
}

/** Variablerne en mødebesked leverer (jf. kataloget). `link` udelades hvis appens URL ikke er sat. */
export function meetingVariables(
  context: MeetingContext,
  extra: VariableValues = {},
  env: Record<string, string | undefined> = process.env,
): VariableValues {
  return {
    board_navn: context.boardName,
    moede_tidspunkt: formatMeetingTime(context.startsAt),
    link: appLink(`/moeder/${context.meetingId}`, appUrl(env)),
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Resultat
// ---------------------------------------------------------------------------------------------

export interface DispatchSummary {
  /** Antal kanaludsendelser pr. udfald. */
  sendt: number;
  stub: number;
  demo: number;
  fejlet: number;
  duplikat: number;
}

export function emptySummary(): DispatchSummary {
  return { sendt: 0, stub: 0, demo: 0, fejlet: 0, duplikat: 0 };
}

function tally(summary: DispatchSummary, outcomes: readonly SendOutcome[]): void {
  for (const outcome of outcomes) summary[outcome.status] += 1;
}

/** Variabler for alle modtagere, eller en funktion når de er personlige (rating-linket). */
type VariablesFor = VariableValues | ((recipientUserId: string) => Promise<VariableValues>);

async function dispatch(
  type: string,
  context: MeetingContext,
  recipients: readonly string[],
  variables: VariablesFor,
  discriminator: string | undefined,
  deps: EngineDeps,
): Promise<DispatchSummary> {
  const summary = emptySummary();
  for (const recipientUserId of recipients) {
    const outcomes = await sendNotification(
      {
        type,
        recipientUserId,
        relatedId: context.meetingId,
        variables: typeof variables === "function" ? await variables(recipientUserId) : variables,
        discriminator,
      },
      deps,
    );
    tally(summary, outcomes);
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Aflysning / flytning (hændelsesdrevet)
// ---------------------------------------------------------------------------------------------

export type MeetingChange = "aflyst" | "flyttet";

/**
 * Giv boardets partnere besked om at et møde er aflyst eller flyttet.
 *
 * Modtagerne er partnerne: det er EJEREN der aflyser/flytter, og har selv set resultatet.
 * (Kataloget nævner «ejer og boardets partnere»; en bekræftelse til ejeren er en
 * tilføjelse ejeren ikke har bedt om. TODO(ejer): skal ejeren også have en bekræftelse?)
 *
 * `discriminator` indgår i idempotensnøglen — byg den med `meetingChangeDiscriminator`, så
 * appens handling og Cal.com-webhookens ekko af SAMME ændring giver samme nøgle (B-40).
 */
export async function notifyMeetingChanged(
  service: SupabaseClient,
  meetingId: string,
  change: MeetingChange,
  discriminator: string,
  deps: EngineDeps = createEngineDeps(),
): Promise<DispatchSummary> {
  const context = await loadMeetingContext(service, meetingId);
  if (!context) throw new Error("Mødet findes ikke.");
  return dispatch(
    "meeting-changed",
    context,
    context.partnerUserIds,
    meetingVariables(context, { aendring: change }),
    `${change}:${discriminator}`,
    deps,
  );
}

/**
 * Idempotens-diskriminatoren for en mødeændring, afledt af TILSTANDEN frem for af hvornår den
 * blev registreret (B-40). Når ejeren aflyser i appen, aflyser appen også hos Cal.com, og Cal.com
 * sender så selv en BOOKING_CANCELLED-webhook — med en tidsbaseret nøgle ville partnerne få to
 * beskeder. Med en tilstandsbaseret nøgle er appens besked og webhookens ekko samme besked:
 *   - aflyst: et møde aflyses kun én gang → fast diskriminator.
 *   - flyttet: det nye starttidspunkt (normaliseret ISO) → en senere flytning til et ANDET
 *     tidspunkt er en ny besked; en genlevering eller et ekko er ikke.
 * Kant: flyttes et møde frem og tilbage til et tidspunkt der allerede er meldt, meldes det ikke
 * igen. Det er prisen for at et ekko aldrig giver dobbeltbesked.
 */
export function meetingChangeDiscriminator(change: MeetingChange, startsAt?: string): string {
  if (change === "aflyst") return "endelig";
  if (!startsAt) throw new Error("En flytning kræver det nye starttidspunkt.");
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) throw new Error("Ugyldigt starttidspunkt for flytningen.");
  return at.toISOString();
}

/**
 * Kør `notifyMeetingChanged` EFTER svaret er sendt (`after`), og lad aldrig en fejl herfra
 * nå handlingen: en aflysning er foretaget, uanset om en e-mail kunne sendes. Fejlen logges
 * (skrubbet for persondata). Uden for en request (tests, scripts) kører den i stedet inline.
 */
export function scheduleMeetingChangedNotification(
  service: SupabaseClient,
  meetingId: string,
  change: MeetingChange,
  discriminator: string,
): void {
  const run = async () => {
    try {
      await notifyMeetingChanged(service, meetingId, change, discriminator);
    } catch (error) {
      console.error(`[notifications] meeting-changed fejlede for møde ${meetingId}: ${scrubError(error)}`);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---------------------------------------------------------------------------------------------
// Planlagte udsendelser (påmindelse, ratinganmodning)
// ---------------------------------------------------------------------------------------------

export type ScheduledRun =
  /** Ejeren har ikke fastsat tidspunktet (katalogets `schedule` er null) — intet sendt. */
  | { status: "ikke-fastlagt"; reason: string }
  | { status: "koert"; meetings: number; summary: DispatchSummary };

export interface ScheduledRunOptions {
  /** Overstyr katalogets tidsplan (tests). Produktionskald udelader den. */
  schedule?: NotificationSchedule | null;
  deps?: EngineDeps;
  env?: Record<string, string | undefined>;
  /** Overstyr rating-linkenes lager/hemmelighed (tests). Produktionskald udelader den. */
  ratingLinks?: RatingLinkDeps;
}

function resolveSchedule(typeKey: string, options: ScheduledRunOptions): NotificationSchedule | null {
  if (options.schedule !== undefined) return options.schedule;
  return getNotificationType(typeKey)?.schedule ?? null;
}

const MINUTE = 60_000;

/** Find planlagte møder der starter inden for `offsetMinutes` fra `now` — de skylder en påmindelse. */
export function reminderWindow(now: Date, schedule: NotificationSchedule): { from: string; to: string } {
  return {
    from: now.toISOString(),
    to: new Date(now.getTime() + schedule.offsetMinutes * MINUTE).toISOString(),
  };
}

/**
 * Send påmindelser for møder der nærmer sig. «Nærmer sig» = starter i løbet af de næste
 * `offsetMinutes`. Kan køres så ofte man vil: idempotensnøglen (med mødets starttidspunkt som
 * diskriminator) sørger for én påmindelse pr. modtager, kanal og tidspunkt — og en flyttet
 * mødetid er et nyt tidspunkt og dermed en ny påmindelse.
 */
export async function sendMeetingReminders(
  now: Date,
  service: SupabaseClient,
  options: ScheduledRunOptions = {},
): Promise<ScheduledRun> {
  const schedule = resolveSchedule("meeting-reminder", options);
  if (!schedule) {
    return { status: "ikke-fastlagt", reason: "Påmindelsens tidspunkt er ikke fastlagt (TODO(ejer))." };
  }
  const deps = options.deps ?? createEngineDeps(options.env);
  const window = reminderWindow(now, schedule);

  const { data, error } = await service
    .from("meeting")
    .select(MEETING_SELECT)
    .eq("status", "planlagt")
    .gt("starts_at", window.from)
    .lte("starts_at", window.to);
  if (error) throw new Error(`Kunne ikke finde møder til påmindelse: ${error.message}`);

  const contexts = ((data ?? []) as unknown as MeetingRow[]).map(toContext).filter((c) => c !== null);
  const summary = emptySummary();
  for (const context of contexts) {
    const recipients = [context.ownerUserId, ...context.partnerUserIds];
    const part = await dispatch(
      "meeting-reminder",
      context,
      recipients,
      meetingVariables(context, {}, options.env),
      `starter:${context.startsAt}`,
      deps,
    );
    for (const key of Object.keys(summary) as Array<keyof DispatchSummary>) summary[key] += part[key];
  }
  return { status: "koert", meetings: contexts.length, summary };
}

/**
 * Teknisk slæk på forespørgslens nedre grænse, så den ikke afhænger af mødets varighed (60 min
 * i dag, 0012). Det eksakte filter — mødets SLUT i vinduet — anvendes i kode bagefter.
 */
const DURATION_SLACK_MS = 24 * 60 * MINUTE;

/** Vinduet et afholdt møde skal have sluttet i for at skylde en ratinganmodning nu. */
export function ratingWindow(
  now: Date,
  schedule: NotificationSchedule,
): { endedAfter: Date; endedBefore: Date } {
  const endedBefore = new Date(now.getTime() - schedule.offsetMinutes * MINUTE);
  const endedAfter = new Date(endedBefore.getTime() - (schedule.catchUpMinutes ?? 0) * MINUTE);
  return { endedAfter, endedBefore };
}

/** Hvem modtageren vurderer SOM: ejeren som sig selv, en partner som sin katalogpost. */
function raterFor(context: MeetingContext, recipientUserId: string): LinkRater | null {
  if (recipientUserId === context.ownerUserId) return { kind: "user", userId: recipientUserId };
  const partnerProfileId = context.partnerProfileIdByUserId[recipientUserId];
  return partnerProfileId ? { kind: "partner", partnerProfileId } : null;
}

/**
 * Variablerne til én modtagers ratinganmodning. `link` er modtagerens PERSONLIGE signerede
 * engangslink (B-21, ADR 0060), så vurderingen kan afgives fra mailen uden login.
 *
 * Kan der ikke udstedes et — `RATING_LINK_SECRET` er ikke sat, appens URL er ukendt, modtageren
 * kan ikke knyttes til mødet, eller udstedelsen fejler — falder `link` tilbage til det
 * loginbeskyttede link til `/moeder/[id]`. Det er aldrig en usigneret genvej: fallbacken kræver
 * login, som før linkene fandtes. En fejl logges (skrubbet) men fejler ikke udsendelsen.
 */
async function ratingRequestVariables(
  context: MeetingContext,
  recipientUserId: string,
  linkDeps: RatingLinkDeps,
  env: Record<string, string | undefined> | undefined,
): Promise<VariableValues> {
  const base = meetingVariables(context, {}, env);
  const url = appUrl(env);
  const rater = raterFor(context, recipientUserId);
  // Uden appens URL kan et link ikke gøres absolut — og så udstedes der heller ingen række.
  if (!url || !rater) return base;
  try {
    const issued = await issueRatingLink(linkDeps, { meetingId: context.meetingId, rater });
    return issued ? { ...base, link: appLink(issued.path, url) } : base;
  } catch (error) {
    console.error(`[notifications] rating-link kunne ikke udstedes for møde ${context.meetingId}: ${scrubError(error)}`);
    return base;
  }
}

/**
 * Send ratinganmodninger for afholdte møder. Et møde skylder en anmodning når det er sluttet
 * for mindst `offsetMinutes` siden, men ikke længere tilbage end `catchUpMinutes` ud over det.
 * Mangler `catchUpMinutes`, tæller kun selve tidspunktet — og så rammer en kørsel næppe noget;
 * begge værdier hører til ejerens beslutning (`schedule`).
 */
export async function sendRatingRequests(
  now: Date,
  service: SupabaseClient,
  options: ScheduledRunOptions = {},
): Promise<ScheduledRun> {
  const schedule = resolveSchedule("rating-request", options);
  if (!schedule) {
    return { status: "ikke-fastlagt", reason: "Ratinganmodningens tidspunkt er ikke fastlagt (TODO(ejer))." };
  }
  const deps = options.deps ?? createEngineDeps(options.env);
  const { endedAfter, endedBefore } = ratingWindow(now, schedule);

  const { data, error } = await service
    .from("meeting")
    .select(MEETING_SELECT)
    .eq("status", "afholdt")
    .lte("starts_at", endedBefore.toISOString())
    .gte("starts_at", new Date(endedAfter.getTime() - DURATION_SLACK_MS).toISOString());
  if (error) throw new Error(`Kunne ikke finde møder til ratinganmodning: ${error.message}`);

  const contexts = ((data ?? []) as unknown as MeetingRow[])
    .map(toContext)
    .filter((c) => c !== null)
    .filter((c) => {
      const end = new Date(c.startsAt).getTime() + c.durationMinutes * MINUTE;
      return end > endedAfter.getTime() && end <= endedBefore.getTime();
    });

  const linkDeps: RatingLinkDeps = options.ratingLinks ?? {
    store: createSupabaseRatingLinkStore(service),
    secret: readRatingLinkSecret(options.env),
    now: () => now,
  };

  const summary = emptySummary();
  for (const context of contexts) {
    const recipients = [context.ownerUserId, ...context.partnerUserIds];
    const part = await dispatch(
      "rating-request",
      context,
      recipients,
      (recipientUserId) => ratingRequestVariables(context, recipientUserId, linkDeps, options.env),
      undefined,
      deps,
    );
    for (const key of Object.keys(summary) as Array<keyof DispatchSummary>) summary[key] += part[key];
  }
  return { status: "koert", meetings: contexts.length, summary };
}

// ---------------------------------------------------------------------------------------------
// Fejlet betaling (hændelsesdrevet — koblingen ejes af betalingsskiven)
// ---------------------------------------------------------------------------------------------

/**
 * Giv ejeren besked om at et træk fejlede. Afsendelsen er bygget; KOBLINGEN er det ikke.
 *
 * TODO(mads): kald denne fra stedet hvor et fejlet træk registreres, når betalingsomlægningen
 * (B-19, ADR 0034/0056) er landet — `src/server/charges/` ejes af den skive og er ikke rørt
 * her. Brug `after`-mønstret fra `scheduleMeetingChangedNotification`, så et fejlet træk
 * aldrig fejler fordi en besked gjorde. `relatedId` er charge-rækkens id.
 */
export async function notifyPaymentFailed(
  service: SupabaseClient,
  chargeId: string,
  deps: EngineDeps = createEngineDeps(),
  env: Record<string, string | undefined> = process.env,
): Promise<SendOutcome[]> {
  const { data, error } = await service
    .from("payment_charge")
    .select("id, membership(board(name, owner_id))")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw new Error(`Kunne ikke læse opkrævningen: ${error.message}`);
  const row = data as unknown as {
    membership:
      | { board: { name: string; owner_id: string } | Array<{ name: string; owner_id: string }> | null }
      | Array<{ board: { name: string; owner_id: string } | Array<{ name: string; owner_id: string }> | null }>
      | null;
  } | null;
  const board = one(one(row?.membership)?.board);
  if (!board) throw new Error("Opkrævningen har intet board.");

  return sendNotification(
    {
      type: "payment-failed",
      recipientUserId: board.owner_id,
      relatedId: chargeId,
      variables: { board_navn: board.name, link: appLink("/betaling", appUrl(env)) },
    },
    deps,
  );
}
