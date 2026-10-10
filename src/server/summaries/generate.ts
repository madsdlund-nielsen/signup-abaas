/**
 * Baggrundsgenerering af mødeopsummeringer (fase 4.4, B-45, ADR 0059). Kaldes af
 * `/api/cron/summaries` med service-role-klienten — aldrig ved sidevisning.
 *
 * For hvert afholdt møde uden `klar`-resumé:
 *   1. samtykke tjekkes (fejler lukket → `mangler_samtykke`, der hentes og sendes INTET),
 *   2. optagelsen hentes (ingen → `mangler_optagelse`),
 *   3. rækken låses med en betinget status-overgang (idempotens: kun én kørsel vinder),
 *   4. lyd → transskription → LLM → resuméet gemmes. Transskriptet gemmes IKKE.
 *
 * Fejl tæller som forsøg; efter `MAX_ATTEMPTS` står rækken som `fejlet`. Intet transskript
 * eller persondata i logs eller `error`-kolonnen — kun mødets id og en kort fejlkode.
 *
 * Demo (ADR 0041): når BÅDE transskription og LLM er demo-adaptere findes der ingen lyd og
 * intet samtykke at tage stilling til — demo-adapterne sender ingenting nogen steder og
 * returnerer faste [DEMO]-tekster. Samtykke-/optagelsestjekket springes KUN over i den situation
 * (`isDemoPath`); så snart én af portene er rigtig (eller stub) gælder tjekket fuldt ud.
 * Samtykke stubbes aldrig: en rigtig adapter kan ikke nås uden det.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapters } from "@/lib";
import { MissingRecordingError, RecordingConsentMissingError } from "@/lib/errors";
import { createLlmProvider, type LlmProvider } from "@/lib/llm";
import {
  createTranscriptionProvider,
  type AudioPayload,
  type RecordingConsent,
  type TranscriptionProvider,
} from "@/lib/transcription";
import { getRecordingConsent } from "@/server/consent/recording";

import { loadMeetingRecording } from "./recording";
import { failureCode, isStaleClaim, statusAfterFailure, type SummaryStatus } from "./status";

/** Hvor mange afholdte møder uden række der køes pr. kørsel (nyeste først). */
const ENQUEUE_LIMIT = 200;
/** Hvor mange mangler_*-rækker der tjekkes igen pr. kørsel (billigt: kun læsninger). */
const RECHECK_LIMIT = 200;
/**
 * Møder der behandles pr. kørsel. Lavt med vilje: en rigtig transskription af 75 minutter kan
 * tage minutter, og kørslen skal holde sig inden for platformens funktionstid (ADR 0059).
 */
export const DEFAULT_BATCH_LIMIT = 3;

export interface SummaryDeps {
  transcription: TranscriptionProvider;
  llm: LlmProvider;
  getConsent: (meetingId: string) => Promise<RecordingConsent | null>;
  loadRecording: (meetingId: string) => Promise<AudioPayload | null>;
  /** Rapportér en endelig fejl (kode, ikke indhold). Default: analytics-adapteren. */
  report: (code: string, meetingId: string) => Promise<void>;
}

export function defaultDeps(env: Record<string, string | undefined> = process.env): SummaryDeps {
  return {
    transcription: createTranscriptionProvider(env),
    llm: createLlmProvider(env),
    getConsent: getRecordingConsent,
    loadRecording: loadMeetingRecording,
    report: async (code, meetingId) => {
      await getAdapters().analytics.captureException(new Error(`opsummering fejlet: ${code}`), {
        source: "summaries-cron",
        meetingId,
      });
    },
  };
}

/** Demo-stien: begge porte er demo-adaptere, så ingen lyd/samtykke er i spil (se filens header). */
export function isDemoPath(deps: Pick<SummaryDeps, "transcription" | "llm">): boolean {
  return deps.transcription.name === "demo" && deps.llm.name === "demo";
}

/** Mindst én port er en stub: hullet er synligt, og kørslen rører ingen rækker. */
export function isNotConfigured(deps: Pick<SummaryDeps, "transcription" | "llm">): boolean {
  return deps.transcription.name === "stub" || deps.llm.name === "stub";
}

export interface GenerateResult {
  /** Nye `afventer`-rækker oprettet for afholdte møder der ingen havde. */
  enqueued: number;
  generated: number;
  /** Fejlede forsøg (rækken står som afventer til næste kørsel, eller fejlet). */
  failed: number;
  /** Rækker der står/er sat til mangler_samtykke / mangler_optagelse. */
  missingConsent: number;
  missingRecording: number;
  /** En anden kørsel nåede låsen først. */
  lostClaim: number;
  /** Kørslen rørte intet fordi en port er en stub. */
  notConfigured: boolean;
}

interface SummaryRow {
  id: string;
  meeting_id: string;
  status: SummaryStatus;
  attempts: number;
  updated_at: string;
}

const ROW_COLUMNS = "id, meeting_id, status, attempts, updated_at";

function emptyResult(): GenerateResult {
  return {
    enqueued: 0,
    generated: 0,
    failed: 0,
    missingConsent: 0,
    missingRecording: 0,
    lostClaim: 0,
    notConfigured: false,
  };
}

/** Opret `afventer`-rækker for afholdte møder der ikke har en. Idempotent (unique meeting_id). */
async function enqueueMissing(service: SupabaseClient): Promise<number> {
  const { data, error } = await service
    .from("meeting")
    .select("id, meeting_summary(id)")
    .eq("status", "afholdt")
    .is("meeting_summary", null)
    .order("starts_at", { ascending: false })
    .limit(ENQUEUE_LIMIT);
  if (error) throw new Error(`Kunne ikke læse afholdte møder: ${error.message}`);

  // Belt and braces: filtrér også her, så et embed-filter der ikke virker som forventet
  // stadig kun køer møder uden række.
  const missing = ((data ?? []) as unknown as Array<{ id: string; meeting_summary: unknown }>).filter(
    (m) => !m.meeting_summary || (Array.isArray(m.meeting_summary) && m.meeting_summary.length === 0),
  );
  if (missing.length === 0) return 0;

  const { data: inserted, error: insertError } = await service
    .from("meeting_summary")
    .upsert(
      missing.map((m) => ({ meeting_id: m.id })),
      { onConflict: "meeting_id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) throw new Error(`Kunne ikke oprette opsummeringsrækker: ${insertError.message}`);
  return (inserted ?? []).length;
}

async function listWork(
  service: SupabaseClient,
  now: Date,
  limit: number,
): Promise<{ workable: SummaryRow[]; blocked: SummaryRow[] }> {
  const { data: pending, error } = await service
    .from("meeting_summary")
    .select(ROW_COLUMNS)
    .eq("status", "afventer")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Kunne ikke læse opsummeringsrækker: ${error.message}`);

  const { data: generating, error: genError } = await service
    .from("meeting_summary")
    .select(ROW_COLUMNS)
    .eq("status", "genereres")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (genError) throw new Error(`Kunne ikke læse opsummeringsrækker: ${genError.message}`);
  const stale = ((generating ?? []) as unknown as SummaryRow[]).filter((r) => isStaleClaim(r.updated_at, now));

  const { data: blocked, error: blockedError } = await service
    .from("meeting_summary")
    .select(ROW_COLUMNS)
    .in("status", ["mangler_samtykke", "mangler_optagelse"])
    .order("created_at", { ascending: true })
    .limit(RECHECK_LIMIT);
  if (blockedError) throw new Error(`Kunne ikke læse opsummeringsrækker: ${blockedError.message}`);

  return {
    workable: [...((pending ?? []) as unknown as SummaryRow[]), ...stale],
    blocked: (blocked ?? []) as unknown as SummaryRow[],
  };
}

/** Sæt en blokeret tilstand — kun hvis den ændrer sig (ingen skrivestorm for rækker der bliver stående). */
async function markBlocked(
  service: SupabaseClient,
  row: SummaryRow,
  status: "mangler_samtykke" | "mangler_optagelse",
  now: Date,
): Promise<void> {
  if (row.status === status) return;
  const { error } = await service
    .from("meeting_summary")
    .update({ status, error: null, updated_at: now.toISOString() })
    .eq("id", row.id)
    .eq("status", row.status);
  if (error) throw new Error(`Kunne ikke opdatere opsummeringsrækken: ${error.message}`);
}

/** Lås rækken: betinget på både status og attempts, så præcis én kørsel vinder. */
async function claim(service: SupabaseClient, row: SummaryRow, now: Date): Promise<boolean> {
  const { data, error } = await service
    .from("meeting_summary")
    .update({ status: "genereres", attempts: row.attempts + 1, error: null, updated_at: now.toISOString() })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("attempts", row.attempts)
    .select("id");
  if (error) throw new Error(`Kunne ikke låse opsummeringsrækken: ${error.message}`);
  return (data ?? []).length === 1;
}

type Outcome = "generated" | "failed" | "lostClaim" | "mangler_samtykke" | "mangler_optagelse";

async function processRow(
  service: SupabaseClient,
  row: SummaryRow,
  deps: SummaryDeps,
  now: Date,
  demo: boolean,
): Promise<Outcome> {
  const meetingId = row.meeting_id;

  // --- 1+2: samtykke og optagelse (kun læsninger, før låsen) --------------------------------
  let consent: RecordingConsent | undefined;
  let audio: AudioPayload | undefined;
  let loadError: unknown = null;
  if (!demo) {
    const registered = await deps.getConsent(meetingId);
    if (!registered) {
      await markBlocked(service, row, "mangler_samtykke", now);
      return "mangler_samtykke";
    }
    consent = registered;
    try {
      const recording = await deps.loadRecording(meetingId);
      if (!recording) {
        await markBlocked(service, row, "mangler_optagelse", now);
        return "mangler_optagelse";
      }
      audio = recording;
    } catch (e) {
      loadError = e;
    }
  }

  // --- 3: lås ------------------------------------------------------------------------------
  if (!(await claim(service, row, now))) return "lostClaim";
  const attempts = row.attempts + 1;

  // --- 4: generér og gem -------------------------------------------------------------------
  try {
    if (loadError) throw loadError;
    const transcript = await deps.transcription.transcribe({
      meetingId,
      audioRef: meetingId,
      ...(consent ? { consent } : {}),
      ...(audio ? { audio } : {}),
    });
    const result = await deps.llm.summarizeMeeting({ meetingId, transcript: transcript.text });
    const { data, error } = await service
      .from("meeting_summary")
      .update({
        status: "klar",
        summary: result.summary,
        action_items: result.actionItems,
        provider: deps.llm.name,
        model: deps.llm.model ?? null,
        error: null,
        generated_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "genereres")
      .select("id");
    if (error) throw new Error("meeting_summary kunne ikke opdateres");
    return (data ?? []).length === 1 ? "generated" : "lostClaim";
  } catch (e) {
    // Adapterens egen fejl-lukket-afvisning er en tilstand, ikke en fejl: intet forsøg brændt.
    if (e instanceof RecordingConsentMissingError || e instanceof MissingRecordingError) {
      const status = e instanceof RecordingConsentMissingError ? "mangler_samtykke" : "mangler_optagelse";
      await service
        .from("meeting_summary")
        .update({ status, attempts: row.attempts, error: null, updated_at: now.toISOString() })
        .eq("id", row.id)
        .eq("status", "genereres");
      return status;
    }

    const code = failureCode(e);
    const next = statusAfterFailure(attempts);
    await service
      .from("meeting_summary")
      .update({ status: next, error: code, updated_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "genereres");
    // Kun koden og mødets id — aldrig transskript, resumé eller fejlens besked.
    console.error(`[summaries] møde ${meetingId}: ${code} (forsøg ${attempts})`);
    if (next === "fejlet") await deps.report(code, meetingId);
    return "failed";
  }
}

/**
 * Find afholdte møder uden `klar`-resumé og generér op til `limit` af dem. Idempotent og sikker
 * at køre samtidig/gentagne gange. Kaster kun hvis de grundlæggende læsninger fejler.
 */
export async function generatePendingSummaries(
  service: SupabaseClient,
  now: Date = new Date(),
  limit: number = DEFAULT_BATCH_LIMIT,
  deps: SummaryDeps = defaultDeps(),
): Promise<GenerateResult> {
  const result = emptyResult();
  if (isNotConfigured(deps)) {
    // Synligt hul, ikke et gæt: ingen rækker røres, ingen forsøg brændes.
    result.notConfigured = true;
    return result;
  }
  const demo = isDemoPath(deps);

  result.enqueued = await enqueueMissing(service);
  const { workable, blocked } = await listWork(service, now, limit);

  let budget = limit;
  for (const row of [...workable, ...blocked]) {
    if (budget <= 0) break;
    const outcome = await processRow(service, row, deps, now, demo);
    if (outcome === "generated") result.generated += 1;
    else if (outcome === "failed") result.failed += 1;
    else if (outcome === "lostClaim") result.lostClaim += 1;
    else if (outcome === "mangler_samtykke") result.missingConsent += 1;
    else result.missingRecording += 1;
    // Kun rigtigt arbejde bruger af budgettet; de billige genbesøg af blokerede rækker gør ikke.
    if (outcome === "generated" || outcome === "failed") budget -= 1;
  }
  return result;
}
