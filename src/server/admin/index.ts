/**
 * Admin-drift og juridisk interface (fase 5.4 admin-del + 5.5, ADR 0053).
 * Læselogik til /admin/drift og indsigtsudtrækket bag /admin/juridisk.
 */

export { getOpsOverview } from "./ops";
export type { FeeOverview, OpsOverview, WebhookActivity, WebhookEvent } from "./ops";
export type {
  ChargeCounts,
  ChargeFailure,
  MeetingCounts,
  MembershipCounts,
  MissingRegistrations,
  PlatformCounts,
} from "./ops-summary";
export { getIntegrationOverview, listIntegrations } from "./integrations";
export type { IntegrationMode, IntegrationOverview, IntegrationStatus } from "./integrations";
export { NOT_INCLUDED } from "./subject-access";
