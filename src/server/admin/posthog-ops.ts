/**
 * Driftsstatus fra PostHog til /admin/drift (fase 5.4, ADR 0066).
 *
 * Tre udfald, aldrig et gæt:
 *   - `ok`: tallene er læst (`source` siger om de er rigtige eller `[DEMO]`)
 *   - `not_configured`: læsenøglen findes ikke (stub) — siden siger det
 *   - `unreadable`: PostHog svarede ikke brugbart — siden siger "kunne ikke læses"
 *
 * Funktionen kaster aldrig: en fejl hos PostHog må ikke vælte driftssiden. Det er kaldet fra
 * siden der står for admin-tjekket (layoutet); funktionen selv læser ingen brugerdata.
 */

import { createOpsMetricsProvider, type OpsMetrics } from "@/lib/ops-metrics";
import { NotConfiguredError } from "@/lib/errors";

type Env = Record<string, string | undefined>;

export const EVENT_WINDOW_HOURS = 24;
export const ACTIVE_WINDOW_DAYS = 7;

export type PostHogOps =
  | { state: "ok"; source: "real" | "demo"; metrics: OpsMetrics; generatedAt: string }
  | { state: "not_configured" }
  | { state: "unreadable" };

export async function getPostHogOps(env: Env = process.env, now: Date = new Date()): Promise<PostHogOps> {
  const provider = createOpsMetricsProvider(env);
  try {
    const metrics = await provider.getOpsMetrics({
      since: new Date(now.getTime() - EVENT_WINDOW_HOURS * 3_600_000),
      activeSince: new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000),
    });
    return { state: "ok", source: provider.name === "demo" ? "demo" : "real", metrics, generatedAt: now.toISOString() };
  } catch (error) {
    if (error instanceof NotConfiguredError) return { state: "not_configured" };
    // Kun navn og besked — adapterens fejl bærer aldrig request- eller svarindhold.
    console.error("[admin/drift] PostHog-driftsstatus kunne ikke læses:", error instanceof Error ? error.message : "ukendt fejl");
    return { state: "unreadable" };
  }
}
