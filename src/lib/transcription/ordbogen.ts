/**
 * Ordbogen/OdinCore transskriptions-adapter (ADR 0024 + 0058): lyd → tekst via den
 * OpenAI-kompatible `POST /v1/audio/transcriptions` (multipart/form-data, synkront JSON-svar).
 * Domænet ser kun `TranscriptionProvider`-porten.
 *
 * 🔴 SAMTYKKE TIL OPTAGELSE (ejerens punkt) stubbes og omgås ALDRIG: adapteren kalder ikke
 * leverandøren uden et registreret samtykke for netop dette møde — den fejler lukket med
 * `RecordingConsentMissingError`. Kontrollen ligger HER (sidste led før lyden forlader os),
 * ikke kun i kalderen.
 *
 * Aldrig logning af lyd eller transskript.
 *
 * TODO(mads): verificér mod OdinCore live — (1) modelnavnet (spec'ens eksempel er `whisper-1`;
 *   den rigtige Ordbogen-model står i `GET /v1/models`), (2) at `language` accepterer ISO 639-1
 *   `da` (spec'en siger kun "hint for a specific language"), (3) max filstørrelse/-varighed
 *   (ikke dokumenteret) og om 75 min lyd kan sendes i ét kald, (4) svartid for lang lyd —
 *   kaldet er synkront (se ADR 0058: kør det i en baggrundsfunktion, ikke i en sidevisning).
 */

import { MissingRecordingError, RecordingConsentMissingError } from "../errors";
import { ordbogenFetch, OrdbogenError, type OrdbogenConfig } from "../ordbogen/client";
import type { Transcript, TranscriptionProvider, TranscriptionRequest } from "./port";

export interface OrdbogenTranscriptionConfig extends OrdbogenConfig {
  /** Default `whisper-1` (spec'ens eksempelmodel). Overstyres af `ORDBOGEN_TRANSCRIPTION_MODEL`. */
  model: string;
  timeoutMs?: number;
}

export const ORDBOGEN_DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

/** Lang lyd transskriberes synkront; tidsfristen er rummelig men ikke åben. */
const DEFAULT_TIMEOUT_MS = 600_000;

/** Ren form-bygger (unit-testbar): spec'ens `TranscriptionMultipartRequest`. */
export function buildTranscriptionForm(
  model: string,
  audio: NonNullable<TranscriptionRequest["audio"]>,
): FormData {
  const form = new FormData();
  form.append("file", new Blob([audio.data as BlobPart], { type: audio.contentType }), audio.filename);
  form.append("model", model);
  form.append("language", "da");
  form.append("response_format", "json");
  return form;
}

function normalizeLanguage(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") return "da-DK";
  const l = raw.trim().toLowerCase();
  return l === "da" || l === "danish" || l === "dansk" || l === "da-dk" ? "da-DK" : raw.trim();
}

/** Ren parser (unit-testbar): `{ text, language? }` → `Transcript` (BCP-47, default da-DK). */
export function parseTranscriptionResponse(payload: unknown): Transcript {
  const { text, language } = (payload ?? {}) as { text?: unknown; language?: unknown };
  if (typeof text !== "string") {
    throw new OrdbogenError("transcribe", "svaret manglede transskriptet.");
  }
  if (text.trim() === "") {
    throw new OrdbogenError("transcribe", "transskriptet er tomt (ingen tale genkendt).");
  }
  return { text: text.trim(), language: normalizeLanguage(language) };
}

export class OrdbogenTranscriptionProvider implements TranscriptionProvider {
  readonly name = "ordbogen";

  constructor(private readonly config: OrdbogenTranscriptionConfig) {}

  async transcribe(req: TranscriptionRequest): Promise<Transcript> {
    // Rækkefølgen er bevidst: samtykke FØR alt andet, så lyden aldrig engang inspiceres uden.
    if (!req.consent || req.consent.meetingId !== req.meetingId) {
      throw new RecordingConsentMissingError(req.meetingId);
    }
    if (!req.audio || req.audio.data.byteLength === 0) {
      throw new MissingRecordingError(req.meetingId);
    }
    const payload = await ordbogenFetch(this.config, "transcribe", "/audio/transcriptions", {
      body: buildTranscriptionForm(this.config.model, req.audio),
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return parseTranscriptionResponse(payload);
  }
}
