import { isDemoMode, isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { resolveOrdbogenConfig } from "../ordbogen/client";
import { DemoLlmProvider } from "./demo";
import { ORDBOGEN_DEFAULT_LLM_MODEL, OrdbogenLlmProvider } from "./ordbogen";
import type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./port";

export type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./port";

interface LlmConfig {
  apiKey: string | undefined;
  apiUrl: string;
  model: string;
}

// Nøglen: LLM_API_KEY vinder, ellers den fælles ORDBOGEN_API_KEY (ADR 0058).
function readConfig(env: Record<string, string | undefined>): LlmConfig {
  const { apiKey, apiUrl } = resolveOrdbogenConfig(env, env.LLM_API_KEY);
  return { apiKey, apiUrl, model: env.ORDBOGEN_LLM_MODEL?.trim() || ORDBOGEN_DEFAULT_LLM_MODEL };
}

function isConfigured(c: LlmConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError — flag eller Ordbogen-nøgle mangler. */
class StubLlmProvider implements LlmProvider {
  readonly name = "stub";
  async summarizeMeeting(_req: MeetingSummaryRequest): Promise<MeetingSummary> {
    throw new NotConfiguredError("llm", "summarizeMeeting");
  }
}

export function createLlmProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const config = readConfig(env);
  if (isEnabled("aiFollowup", env) && isConfigured(config)) {
    return new OrdbogenLlmProvider({ apiKey: config.apiKey as string, apiUrl: config.apiUrl, model: config.model });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoLlmProvider();
  return new StubLlmProvider();
}
