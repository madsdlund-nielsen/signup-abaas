/**
 * AI-opsummering af et afholdt møde (Fase 4.4, bygget skærm-først — ADR 0042).
 *
 * Skærmen bygges før logikken: i dag hentes opsummeringen ved læsning gennem portene
 * (transskription → LLM), så den kan klikkes og designes mod demo-adapterne (ADR 0041).
 * Ordbogen-adapterne er bygget (ADR 0058), men datakilden skal skifte FØR flaget tændes mod en
 * rigtig nøgle: resuméet gemmes i Supabase som mødeartefakt (docs/fase-4.md §4.4) og genereres
 * af én handling bag samtykke i en baggrundsfunktion — ikke ved hver læsning (backlog B-45). Signaturen her er den samme før og efter; det er kun kilden der skifter.
 *
 * Synlighed: restriktiv default (fase-4.md §4.4) — kun boardets ejer får den vist.
 * Håndhæves i siden, fordi der endnu ikke findes en tabel at lægge RLS på.
 * TODO(ejer): note-synlighed — gælder også resuméer.
 *
 * Uden konfigurerede adaptere (stub) er svaret et synligt hul — ikke en tom streng og ikke
 * et gæt (docs/stub-politik.md). Siden viser hullet; den crasher ikke.
 */

import { NotConfiguredError } from "@/lib/errors";
import { createLlmProvider } from "@/lib/llm";
import { createTranscriptionProvider } from "@/lib/transcription";
import { getRecordingConsent } from "@/server/consent/recording";
import { loadMeetingRecording } from "./recording";

export type MeetingSummaryState =
  | {
      kind: "ready";
      /** "demo" = demo-adapteren (ADR 0041); "live" = en rigtig leverandør. */
      source: "demo" | "live";
      summary: string;
      actionItems: string[];
    }
  | { kind: "unavailable"; reason: string };

export async function getMeetingSummary(
  meetingId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<MeetingSummaryState> {
  const transcription = createTranscriptionProvider(env);
  const llm = createLlmProvider(env);
  try {
    // 🔴 Samtykke til optagelse (ejerens punkt, ADR 0058): kæden starter ved en optagelse der
    // KUN må bruges med registreret samtykke. Lyden hentes først når samtykket findes, og den
    // rigtige adapter afviser desuden selv uden det (fejler lukket) — to uafhængige led.
    // Demoen har hverken lyd eller samtykke; audioRef er mødets id.
    // TODO(ejer): samtykke til mødeoptagelse — mekanismen findes ikke, så rigtig transskription
    // afvises indtil den gør.
    const consent = await getRecordingConsent(meetingId);
    const audio = consent ? await loadMeetingRecording(meetingId) : null;
    const transcript = await transcription.transcribe({
      meetingId,
      audioRef: meetingId,
      ...(consent ? { consent } : {}),
      ...(audio ? { audio } : {}),
    });
    const result = await llm.summarizeMeeting({ meetingId, transcript: transcript.text });
    return {
      kind: "ready",
      source: llm.name === "demo" ? "demo" : "live",
      summary: result.summary,
      actionItems: result.actionItems,
    };
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      return {
        kind: "unavailable",
        reason:
          "AI-opfølgning er ikke konfigureret endnu — Ordbogen-nøgle og feature-flag mangler.",
      };
    }
    return { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}
