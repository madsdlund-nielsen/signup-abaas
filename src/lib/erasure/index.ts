import { isDemoMode, isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { DemoProcessorEraser } from "./demo";
import type { ErasureSubject, ProcessorEraser, ProcessorErasureReceipt, ProcessorId } from "./port";
import { POSTHOG_ERASURE_DEFAULT_HOST, PostHogProcessorEraser } from "./posthog";
import { ResendProcessorEraser } from "./resend";

export type {
  ErasureSubject,
  ProcessorEraser,
  ProcessorErasureReceipt,
  ProcessorErasureStatus,
  ProcessorId,
} from "./port";

type Env = Record<string, string | undefined>;

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Stub: kaster NotConfiguredError — en sletning der ikke blev forsøgt må aldrig se gennemført ud. */
class StubProcessorEraser implements ProcessorEraser {
  readonly name = "stub";
  constructor(
    readonly processor: ProcessorId,
    private readonly vendor: string,
  ) {}
  async eraseDataSubject(_subject: ErasureSubject): Promise<ProcessorErasureReceipt> {
    throw new NotConfiguredError(this.vendor, "eraseDataSubject");
  }
}

// Samme flag som skrive-porten (`analytics`). Nøglen er en ANDEN end ingest-nøglen: en personal API key
// med skrive-scope til personer (se ./posthog) — samme env-navne som drifts-læsningen (ADR 0066).
export function createPostHogEraser(env: Env = process.env): ProcessorEraser {
  const personalApiKey = nonEmpty(env.POSTHOG_PERSONAL_API_KEY);
  const projectId = nonEmpty(env.POSTHOG_PROJECT_ID);
  const configured = Boolean(personalApiKey && projectId);
  if (isEnabled("analytics", env) && configured) {
    return new PostHogProcessorEraser({
      personalApiKey: personalApiKey as string,
      projectId: projectId as string,
      host: (nonEmpty(env.POSTHOG_API_HOST) ?? POSTHOG_ERASURE_DEFAULT_HOST).replace(/\/+$/, ""),
    });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !configured) return new DemoProcessorEraser("posthog");
  return new StubProcessorEraser("posthog", "posthog");
}

export function createResendEraser(env: Env = process.env): ProcessorEraser {
  const apiKey = nonEmpty(env.RESEND_API_KEY);
  if (isEnabled("email", env) && apiKey) return new ResendProcessorEraser({ apiKey });
  if (isDemoMode(env) && !apiKey) return new DemoProcessorEraser("resend");
  return new StubProcessorEraser("resend", "resend");
}

/** De behandlere der har en automatisk sletning (rigtig, demo eller stub). Resten er manuelle punkter. */
export function createProcessorErasers(env: Env = process.env): ProcessorEraser[] {
  return [createPostHogEraser(env), createResendEraser(env)];
}
