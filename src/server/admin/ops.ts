/**
 * Driftsoverblik for admin (fase 5.4, ADR 0053). Læsning via den AUTHEDE server-klient —
 * RLS afgør hvad der er synligt (admin ser alt på tabellerne her, jf. 0002/0009/0012/0013),
 * så service-role bruges ikke. Modulet er derfor ikke i sig selv et autorisationslag; kaldstedet
 * (/admin/drift) står bag rolle-guarden i `/admin/layout.tsx`, og vi kræver admin igen her som
 * andet lag, ligesom resten af admin-fladen.
 *
 * Hver sektion hentes for sig, og en sektion der fejler bliver `null` — aldrig et nul. Et
 * driftsoverblik der viser "0 fejlede træk" fordi forespørgslen fejlede, er værre end ingen
 * tal (docs/stub-politik.md: synlige huller frem for stille gæt). Fejlen logges uden persondata.
 *
 * Rækkegrænsen er PostgREST' standard (1000). Rammer en sektion den, markeres overblikket
 * `truncated`, og skærmen siger "mindst" frem for at lade et afkortet tal passere som totalen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import { loadFeeTotals, monthOf, monthPeriod, type FeeTotals } from "@/server/fees";
import {
  MEETING_WINDOW_DAYS,
  countCharges,
  countMeetings,
  countMemberships,
  countMissingRegistrations,
  countPlatform,
  type BoardRow,
  type ChargeCounts,
  type ChargeRow,
  type MeetingCounts,
  type MeetingRow,
  type MembershipCounts,
  type MembershipRow,
  type MissingRegistrationRow,
  type MissingRegistrations,
  type PartnerRow,
  type PlatformCounts,
} from "./ops-summary";

export const ROW_LIMIT = 1000;
export const WEBHOOK_EVENT_LIMIT = 10;

export interface WebhookEvent {
  provider: string;
  eventType: string;
  receivedAt: string;
}

export interface WebhookActivity {
  meeting: WebhookEvent[];
  payment: WebhookEvent[];
}

/** Indeværende måneds honorar (fase 5.4, ADR 0055): optælling pr. linjestatus, ikke en opgørelse. */
export interface FeeOverview {
  /** "ÅÅÅÅ-MM" (dansk tid). */
  month: string;
  totals: FeeTotals;
  /** Antal honorarregel-versioner — 0 = satsen er ikke fastsat, og intet beløb kan beregnes. */
  ruleCount: number;
}

export interface OpsOverview {
  generatedAt: string;
  platform: PlatformCounts | null;
  memberships: MembershipCounts | null;
  charges: ChargeCounts | null;
  meetings: MeetingCounts | null;
  missingRegistrations: MissingRegistrations | null;
  fees: FeeOverview | null;
  webhooks: WebhookActivity | null;
  /** Mindst én sektion ramte rækkegrænsen — tallene er et gulv, ikke totalen. */
  truncated: boolean;
}

interface WebhookRow {
  provider: string;
  event_type: string;
  received_at: string;
}

interface Section<T> {
  value: T | null;
  truncated: boolean;
}

/** Kør en sektion; en fejl bliver til `null` + log (uden persondata), aldrig til et nul. */
async function section<T>(
  name: string,
  run: () => Promise<{ value: T; truncated: boolean }>,
): Promise<Section<T>> {
  try {
    return await run();
  } catch (e) {
    console.error(`[admin/drift] ${name} fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return { value: null, truncated: false };
  }
}

async function rows<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const list = (data ?? []) as T[];
  return { rows: list, truncated: list.length >= ROW_LIMIT };
}

function toWebhookEvents(list: readonly WebhookRow[]): WebhookEvent[] {
  return list.map((r) => ({ provider: r.provider, eventType: r.event_type, receivedAt: r.received_at }));
}

async function loadPlatform(db: SupabaseClient) {
  const [boards, partners] = await Promise.all([
    rows<BoardRow>(db.from("board").select("owner_id").limit(ROW_LIMIT)),
    rows<PartnerRow>(db.from("partner_profile").select("app_user_id").limit(ROW_LIMIT)),
  ]);
  return {
    value: countPlatform(boards.rows, partners.rows),
    truncated: boards.truncated || partners.truncated,
  };
}

async function loadMemberships(db: SupabaseClient) {
  const result = await rows<MembershipRow>(
    db.from("membership").select("status, card_status").limit(ROW_LIMIT),
  );
  return { value: countMemberships(result.rows), truncated: result.truncated };
}

async function loadCharges(db: SupabaseClient) {
  const result = await rows<ChargeRow>(
    db
      .from("payment_charge")
      .select("id, status, failure_reason, updated_at")
      .order("updated_at", { ascending: false })
      .limit(ROW_LIMIT),
  );
  return { value: countCharges(result.rows), truncated: result.truncated };
}

async function loadMeetings(db: SupabaseClient, now: Date) {
  const since = new Date(now.getTime() - MEETING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Vinduet PLUS alt der stadig er planlagt: et møde der burde være afsluttet for en måned
  // siden er netop det en driftsskærm skal fange.
  const result = await rows<MeetingRow>(
    db
      .from("meeting")
      .select("status, starts_at")
      .or(`starts_at.gte.${since},status.eq.planlagt`)
      .limit(ROW_LIMIT),
  );
  return { value: countMeetings(result.rows, now), truncated: result.truncated };
}

async function loadMissingRegistrations(db: SupabaseClient) {
  // Alle afholdte møder, ikke kun vinduet: en manglende registrering bliver ikke mindre
  // manglende af at være gammel — og honoraropgørelsen (fase 5.1) hviler på den.
  const result = await rows<MissingRegistrationRow>(
    db
      .from("meeting_partner")
      .select("meeting_id, meeting!inner(status)")
      .is("registered_status", null)
      .eq("meeting.status", "afholdt")
      .limit(ROW_LIMIT),
  );
  return { value: countMissingRegistrations(result.rows), truncated: result.truncated };
}

async function loadFees(db: SupabaseClient, now: Date) {
  const period = monthPeriod(monthOf(now));
  const result = await loadFeeTotals(db, period, ROW_LIMIT);
  return {
    value: { month: period.month, totals: result.totals, ruleCount: result.ruleCount },
    truncated: result.lineCount >= ROW_LIMIT,
  };
}

async function loadWebhooks(db: SupabaseClient) {
  const [meeting, payment] = await Promise.all([
    rows<WebhookRow>(
      db
        .from("meeting_webhook_event")
        .select("provider, event_type, received_at")
        .order("received_at", { ascending: false })
        .limit(WEBHOOK_EVENT_LIMIT),
    ),
    rows<WebhookRow>(
      db
        .from("payment_webhook_event")
        .select("provider, event_type, received_at")
        .order("received_at", { ascending: false })
        .limit(WEBHOOK_EVENT_LIMIT),
    ),
  ]);
  // Listerne er bevidst afkortet til de seneste — det er ikke en truncation i tallets forstand.
  return {
    value: { meeting: toWebhookEvents(meeting.rows), payment: toWebhookEvents(payment.rows) },
    truncated: false,
  };
}

/**
 * Hent driftsoverblikket. `null` når Supabase ikke er konfigureret (kontofri CI/dev);
 * kaster hvis den nuværende bruger ikke er admin.
 */
export async function getOpsOverview(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<OpsOverview | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  requireRole(await getCurrentUser(env), "admin");
  const db = await createServerSupabase(config);

  const [platform, memberships, charges, meetings, missing, fees, webhooks] = await Promise.all([
    section("board/partner", () => loadPlatform(db)),
    section("membership", () => loadMemberships(db)),
    section("payment_charge", () => loadCharges(db)),
    section("meeting", () => loadMeetings(db, now)),
    section("meeting_partner", () => loadMissingRegistrations(db)),
    section("partner_fee_line", () => loadFees(db, now)),
    section("webhook", () => loadWebhooks(db)),
  ]);

  return {
    generatedAt: now.toISOString(),
    platform: platform.value,
    memberships: memberships.value,
    charges: charges.value,
    meetings: meetings.value,
    missingRegistrations: missing.value,
    fees: fees.value,
    webhooks: webhooks.value,
    truncated: [platform, memberships, charges, meetings, missing, fees].some((s) => s.truncated),
  };
}
