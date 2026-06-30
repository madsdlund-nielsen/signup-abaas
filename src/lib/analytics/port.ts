export interface AnalyticsEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
}

/**
 * Analytics + fejlovervågning. Leverandør: PostHog (EU) — erstatter Sentry.
 * Bemærk: PostHog hører til fase 0, men live-nøglen afventer account-adgang.
 */
export interface Analytics {
  readonly name: string;
  capture(event: AnalyticsEvent): Promise<void>;
  captureException(error: unknown, context?: Record<string, unknown>): Promise<void>;
}
