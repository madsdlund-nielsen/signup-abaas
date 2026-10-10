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
}

interface MeetingRow {
  id: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  board: { name: string; owner_id: string } | Array<{ name: string; owner_id: string }> | null;
  meeting_partner: Array<{
    partner_profile:
      | { app_user_id: string | null }
      | Array<{ app_user_id: string | null }>
      | null;
  }> | null;
}

const MEETING_SELECT =
  "id, starts_at, duration_minutes, status, board(name, owner_id), meeting_partner(partner_profile(app_user_id))";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function toContext(row: MeetingRow): MeetingContext | null {
  // PostgREST to-one-embeds er objekter i praksis, men typeudledningen gætter array.
  const board = one(row.board);
  if (!board) return null;
  const partnerUserIds = (row.meeting_partner ?? [])
    .map((participant) => one(participant.partner_profile)?.app_user_id ?? null)
    .filter((id): id is string => Boolean(id));
  return {
    meetingId: row.id,
    boardName: board.name,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    ownerUserId: board.owner_id,
    partnerUserIds: [...new Set(partnerUserIds)],
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

async function dispatch(
  type: string,
  context: MeetingContext,
  recipients: readonly string[],
  variables: VariableValues,
  discriminator: string | undefined,
  deps: EngineDeps,
): Promise<DispatchSummary> {
  const summary = emptySummary();
  for (const recipientUserId of recipients) {
    const outcomes = await sendNotification(
      { type, recipientUserId, relatedId: context.meetingId, variables, discriminator },
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
 * Modtagerne er partnerne: det er EJEREN der aflyser/flytter, og hun har selv set resultatet.
 * (Kataloget nævner «ejer og boardets partnere»; en bekræftelse til ejeren er en
 * tilføjelse hun ikke har bedt om. TODO(ejer): skal ejeren også have en bekræftelse?)
 *
 * `changedAt` skelner to flytninger af samme møde — den indgår i idempotensnøglen, så en
 * senere, ægte ændring aldrig forveksles med den første.
 */
export async function notifyMeetingChanged(
  service: SupabaseClient,
  meetingId: string,
  change: MeetingChange,
  changedAt: string,
  deps: EngineDeps = createEngineDeps(),
): Promise<DispatchSummary> {
  const context = await loadMeetingContext(service, meetingId);
  if (!context) throw new Error("Mødet findes ikke.");
  return dispatch(
    "meeting-changed",
    context,
    context.partnerUserIds,
    meetingVariables(context, { aendring: change }),
    `${change}:${changedAt}`,
    deps,
  );
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
  changedAt: string,
): void {
  const run = async () => {
    try {
      await notifyMeetingChanged(service, meetingId, change, changedAt);
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

  const summary = emptySummary();
  for (const context of contexts) {
    const recipients = [context.ownerUserId, ...context.partnerUserIds];
    const part = await dispatch(
      "rating-request",
      context,
      recipients,
      meetingVariables(context, {}, options.env),
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
