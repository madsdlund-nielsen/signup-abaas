/**
 * AI-opsummering af et afholdt møde (Fase 4.4, bygget skærm-først — ADR 0042).
 *
 * Skærmen bygges før logikken: i dag hentes opsummeringen ved læsning gennem portene
 * (transskription → LLM), så den kan klikkes og designes mod demo-adapterne (ADR 0041).
 * Når Ordbogen-nøgler og DPA lander, skiftes datakilden: resuméet gemmes i Supabase som
 * mødeartefakt (docs/fase-4.md §4.4) og genereres af én handling bag samtykke — ikke ved
 * hver læsning. Signaturen her er den samme før og efter; det er kun kilden der skifter.
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
    // TODO(ejer): samtykke til optagelse — den rigtige kæde starter ved en optagelse, der KUN
    // findes med samtykke. Demoen har ingen optagelse; audioRef er mødets id.
    const transcript = await transcription.transcribe({ meetingId, audioRef: meetingId });
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
          "AI-opfølgning er ikke konfigureret endnu — Ordbogen-nøgler og databehandleraftale mangler.",
      };
    }
    return { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}
