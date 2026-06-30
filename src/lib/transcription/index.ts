import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { Transcript, TranscriptionProvider, TranscriptionRequest } from "./port";

export type { Transcript, TranscriptionProvider, TranscriptionRequest } from "./port";

interface TranscriptionConfig {
  apiKey: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): TranscriptionConfig {
  return { apiKey: env.TRANSCRIPTION_API_KEY };
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

// TODO(mads): vælg dansk/EU-transskriptionsudbyder og implementér en rigtig adapter.
export function createTranscriptionProvider(
  env: Record<string, string | undefined> = process.env,
): TranscriptionProvider {
  const config = readConfig(env);
  if (isEnabled("transcription", env) && isConfigured(config)) {
    // return new SomeEuTranscriptionProvider(config);
  }
  return new StubTranscriptionProvider();
}
