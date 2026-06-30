import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./port";

export type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./port";

interface LlmConfig {
  apiKey: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): LlmConfig {
  return { apiKey: env.LLM_API_KEY };
}

function isConfigured(c: LlmConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError — EU-residens/DPA ikke verificeret endnu. */
class StubLlmProvider implements LlmProvider {
  readonly name = "stub";
  async summarizeMeeting(_req: MeetingSummaryRequest): Promise<MeetingSummary> {
    throw new NotConfiguredError("llm", "summarizeMeeting");
  }
}

// TODO(mads): vælg LLM (Claude API vs. EU-hostet) efter DPA/EU-residens-verifikation.
export function createLlmProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const config = readConfig(env);
  if (isEnabled("aiFollowup", env) && isConfigured(config)) {
    // return new ClaudeLlmProvider(config);
  }
  return new StubLlmProvider();
}
