/**
 * AI-opsummering af et afholdt møde (Fase 4.4, B-45, ADR 0059): LÆSEVEJEN.
 *
 * Resuméet er et mødeartefakt i `meeting_summary` (0022), genereret ÉN gang af en
 * baggrundskørsel (`./generate`, `/api/cron/summaries`). Siden `/moeder/[id]` læser kun den
 * gemte række — den kalder aldrig transskription eller LLM. Før (ADR 0042, skærm-først) blev
 * der genereret ved hver visning; det ville med de rigtige adaptere have startet en betalt
 * kørsel pr. sidevisning.
 *
 * Synlighed: håndhæves af RLS på `meeting_summary` (boardets ejer + admin). Læsningen her går
 * gennem den authed server-klient, så en bruger uden adgang får 0 rækker — ikke en fejl, og
 * ikke noget siden selv skal sortere. TODO(ejer): note-synlighed (§12 pkt. 16) — gælder også
 * resuméer; udvidelsen er én policy.
 *
 * Demo (ADR 0041): når begge porte er demo-adaptere og der ingen `klar`-række er, bygges et
 * [DEMO]-resumé direkte af demo-adapterne uden at gemme det — som siden altid har gjort. Det
 * rører hverken samtykke eller optagelse: demo-adapterne har ingen lyd og sender intet nogen
 * steder. Så snart en port er rigtig eller stub, gælder den gemte række (og grundlaget) fuldt ud.
 */

import { createLlmProvider } from "@/lib/llm";
import { createTranscriptionProvider } from "@/lib/transcription";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

import type { SummaryStatus } from "./status";

export type MeetingSummaryState =
  | {
      kind: "ready";
      /** "demo" = demo-adapteren (ADR 0041); "live" = en rigtig leverandør. */
      source: "demo" | "live";
      summary: string;
      actionItems: string[];
    }
  /** Rækken afventer eller genereres — resuméet kommer af sig selv. */
  | { kind: "pending" }
  /** 🔴 Intet grundlag (kontrakt, ADR 0065) for mødet — fx et ukendt møde: hverken transskriberet eller opsummeret. */
  | { kind: "missing_consent" }
  | { kind: "missing_recording" }
  /** Opgivet efter flere forsøg — ejeren kan trykke "Generér igen". */
  | { kind: "failed" }
  /** Synligt hul: AI-opfølgning er ikke konfigureret (stub). */
  | { kind: "unavailable"; reason: string };

/** Den del af rækken siden bruger. */
export interface SummaryRow {
  status: SummaryStatus;
  summary: string | null;
  action_items: unknown;
  provider: string | null;
}

const NOT_CONFIGURED_REASON =
  "AI-opfølgning er ikke konfigureret endnu — Ordbogen-nøgle og feature-flag mangler.";

function toActionItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((i): i is string => typeof i === "string");
}

/**
 * Ren afbildning fra den gemte række (eller ingen) til det siden viser. `configured` = begge
 * porte er andet end stub; uden det er der intet at vente på.
 */
export function resolveSummaryState(row: SummaryRow | null, configured: boolean): MeetingSummaryState {
  if (row?.status === "klar" && row.summary) {
    return {
      kind: "ready",
      source: row.provider === "demo" ? "demo" : "live",
      summary: row.summary,
      actionItems: toActionItems(row.action_items),
    };
  }
  // Disse tre er fakta om mødet, uafhængigt af om nøglerne p.t. er sat.
  if (row?.status === "mangler_samtykke") return { kind: "missing_consent" };
  if (row?.status === "mangler_optagelse") return { kind: "missing_recording" };
  if (row?.status === "fejlet") return { kind: "failed" };
  if (!configured) return { kind: "unavailable", reason: NOT_CONFIGURED_REASON };
  return { kind: "pending" };
}

async function readSummaryRow(
  meetingId: string,
  env: Record<string, string | undefined>,
): Promise<SummaryRow | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting_summary")
    .select("status, summary, action_items, provider")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (error) {
    console.error(`[summaries] getMeetingSummary fejlede: ${error.message}`);
    return null;
  }
  return (data as SummaryRow | null) ?? null;
}

export async function getMeetingSummary(
  meetingId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<MeetingSummaryState> {
  const transcription = createTranscriptionProvider(env);
  const llm = createLlmProvider(env);
  const row = await readSummaryRow(meetingId, env);

  // Demo-stien (se filens header): en gemt række vinder; ellers vises demo-resuméet direkte.
  if (transcription.name === "demo" && llm.name === "demo" && row?.status !== "klar") {
    const transcript = await transcription.transcribe({ meetingId, audioRef: meetingId });
    const result = await llm.summarizeMeeting({ meetingId, transcript: transcript.text });
    return { kind: "ready", source: "demo", summary: result.summary, actionItems: result.actionItems };
  }

  return resolveSummaryState(row, transcription.name !== "stub" && llm.name !== "stub");
}
