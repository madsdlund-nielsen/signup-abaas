import { isEnabled } from "@/server/flags";
import type { Analytics, AnalyticsEvent } from "./port";

export type { Analytics, AnalyticsEvent } from "./port";

interface AnalyticsConfig {
  apiKey: string | undefined;
  host: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): AnalyticsConfig {
  return { apiKey: env.POSTHOG_KEY, host: env.POSTHOG_HOST };
}

function isConfigured(c: AnalyticsConfig): boolean {
  return Boolean(c.apiKey && c.host);
}

/** Stub: virker uden nøgler — logger i stedet for at sende til PostHog. */
class StubAnalytics implements Analytics {
  readonly name = "stub";
  async capture(event: AnalyticsEvent): Promise<void> {
    console.info(`[analytics:stub] event ${event.event} (${event.distinctId})`);
  }
  async captureException(error: unknown): Promise<void> {
    console.warn("[analytics:stub] exception", error);
  }
}

// TODO: rigtig PostHog-adapter (EU) når POSTHOG_KEY/POSTHOG_HOST lander (Trin 8).
export function createAnalytics(env: Record<string, string | undefined> = process.env): Analytics {
  const config = readConfig(env);
  if (isEnabled("analytics", env) && isConfigured(config)) {
    // return new PostHogAnalytics(config);
  }
  return new StubAnalytics();
}
