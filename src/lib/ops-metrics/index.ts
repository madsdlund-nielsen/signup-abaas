import { isDemoMode, isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { DemoOpsMetricsProvider } from "./demo";
import { POSTHOG_DEFAULT_API_HOST, PostHogOpsMetricsProvider } from "./posthog";
import type { OpsMetrics, OpsMetricsProvider, OpsMetricsQuery } from "./port";

export type { ExceptionTypeCount, OpsMetrics, OpsMetricsProvider, OpsMetricsQuery } from "./port";

interface OpsMetricsConfig {
  personalApiKey: string | undefined;
  projectId: string | undefined;
  host: string;
}

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

// Server-only nøgler — aldrig NEXT_PUBLIC_. POSTHOG_KEY (ingest) er en anden nøgle og bruges ikke her.
function readConfig(env: Record<string, string | undefined>): OpsMetricsConfig {
  return {
    personalApiKey: nonEmpty(env.POSTHOG_PERSONAL_API_KEY),
    projectId: nonEmpty(env.POSTHOG_PROJECT_ID),
    host: (nonEmpty(env.POSTHOG_API_HOST) ?? POSTHOG_DEFAULT_API_HOST).replace(/\/+$/, ""),
  };
}

function isConfigured(c: OpsMetricsConfig): boolean {
  return Boolean(c.personalApiKey && c.projectId);
}

/** Stub: kaster NotConfiguredError — aldrig nuller der kan læses som rigtige tal. */
class StubOpsMetricsProvider implements OpsMetricsProvider {
  readonly name = "stub";
  async getOpsMetrics(_query: OpsMetricsQuery): Promise<OpsMetrics> {
    throw new NotConfiguredError("posthog-read", "getOpsMetrics");
  }
}

// Samme flag som skrive-porten (`analytics`): ét sted at slå PostHog til og fra.
export function createOpsMetricsProvider(env: Record<string, string | undefined> = process.env): OpsMetricsProvider {
  const config = readConfig(env);
  if (isEnabled("analytics", env) && isConfigured(config)) {
    return new PostHogOpsMetricsProvider({
      personalApiKey: config.personalApiKey as string,
      projectId: config.projectId as string,
      host: config.host,
    });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoOpsMetricsProvider();
  return new StubOpsMetricsProvider();
}
