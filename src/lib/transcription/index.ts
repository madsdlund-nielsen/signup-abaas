import { isDemoMode, isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { resolveOrdbogenConfig } from "../ordbogen/client";
import { DemoTranscriptionProvider } from "./demo";
import { ORDBOGEN_DEFAULT_TRANSCRIPTION_MODEL, OrdbogenTranscriptionProvider } from "./ordbogen";
import type { Transcript, TranscriptionProvider, TranscriptionRequest } from "./port";

export type {
  AudioPayload,
  RecordingConsent,
  Transcript,
  TranscriptionProvider,
  TranscriptionRequest,
} from "./port";

interface TranscriptionConfig {
  apiKey: string | undefined;
  apiUrl: string;
  model: string;
}

// Nøglen: TRANSCRIPTION_API_KEY vinder, ellers den fælles ORDBOGEN_API_KEY (ADR 0058).
function readConfig(env: Record<string, string | undefined>): TranscriptionConfig {
  const { apiKey, apiUrl } = resolveOrdbogenConfig(env, env.TRANSCRIPTION_API_KEY);
  return {
    apiKey,
    apiUrl,
    model: env.ORDBOGEN_TRANSCRIPTION_MODEL?.trim() || ORDBOGEN_DEFAULT_TRANSCRIPTION_MODEL,
  };
}

function isConfigured(c: TranscriptionConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError — udbyder ikke valgt endnu. */
class StubTranscriptionProvider implements TranscriptionProvider {
  readonly name = "stub";
  async transcribe(_req: TranscriptionRequest): Promise<Transcript> {
    throw new NotConfiguredError("transcription", "transcribe");
  }
}

// TODO(ejer): samtykke til mødeoptagelse — adapteren afviser uden registreret samtykke (fejler lukket).
export function createTranscriptionProvider(
  env: Record<string, string | undefined> = process.env,
): TranscriptionProvider {
  const config = readConfig(env);
  if (isEnabled("transcription", env) && isConfigured(config)) {
    return new OrdbogenTranscriptionProvider({
      apiKey: config.apiKey as string,
      apiUrl: config.apiUrl,
      model: config.model,
    });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoTranscriptionProvider();
  return new StubTranscriptionProvider();
}
