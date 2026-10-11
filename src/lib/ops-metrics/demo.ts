import { DEMO_TEXT_PREFIX } from "../demo";
import type { OpsMetrics, OpsMetricsProvider, OpsMetricsQuery } from "./port";

/**
 * Demo (ADR 0041): faste tal så driftsskærmen kan designes før PostHog-læsenøglen findes.
 * Tallene er 1 overalt og fejltypen er mærket [DEMO] — de er ikke målt og forklæder sig ikke.
 */
export class DemoOpsMetricsProvider implements OpsMetricsProvider {
  readonly name = "demo";

  async getOpsMetrics(_query: OpsMetricsQuery): Promise<OpsMetrics> {
    return {
      events: 1,
      exceptions: 1,
      topExceptionTypes: [{ type: `${DEMO_TEXT_PREFIX} DemoFejl`, count: 1 }],
      activePeople: 1,
    };
  }
}
