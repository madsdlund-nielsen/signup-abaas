/**
 * Business-data-access for partner-honorar (Fase 5.1/5.2, ADR 0051). Læsning via den authed
 * klient — RLS afgør hvad der er synligt: viewen `partner_fee_line` (0017) giver en partner
 * kun egne rækker og admin alle, og `fee_rule` er læsbar for admin og partnere. Selve beløbet
 * beregnes her i kode (./algorithm) mod den regel der gælder for mødets starttidspunkt.
 * Writes ligger i ./actions (service-role bag admin). Spejler src/server/pricing.
 * Ukonfigureret Supabase → [] (kontofri CI/dev).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import {
  summarizeFees,
  type FeeAbsenceRule,
  type FeeMeetingStatus,
  type FeeRegisteredStatus,
  type FeeRuleInput,
  type FeeTotals,
  type FeeVatMode,
} from "./algorithm";
import { buildFeeLines, type FeeLine, type FeeLineRow } from "./lines";

export * from "./algorithm";
export * from "./lines";
export * from "./period";

export interface FeeRule extends FeeRuleInput {
  createdAt: string;
}

export interface FeePeriodQuery {
  /** Inklusiv start (ISO). */
  from: string;
  /** Eksklusiv slut (ISO). */
  to: string;
}

interface RuleRow {
  id: string;
  version: number;
  hourly_rate_minor: number;
  currency: string;
  vat_mode: FeeVatMode;
  absence_rule: FeeAbsenceRule;
  effective_from: string;
  created_at: string;
}

interface LineRow {
  meeting_id: string;
  partner_profile_id: string;
  app_user_id: string | null;
  partner_name: string;
  starts_at: string;
  meeting_status: FeeMeetingStatus;
  duration_minutes: number;
  prep_minutes: number;
  registered_status: FeeRegisteredStatus | null;
}

const RULE_COLUMNS =
  "id, version, hourly_rate_minor, currency, vat_mode, absence_rule, effective_from, created_at";
const LINE_COLUMNS =
  "meeting_id, partner_profile_id, app_user_id, partner_name, starts_at, meeting_status, duration_minutes, prep_minutes, registered_status";

function rowToRule(row: RuleRow): FeeRule {
  return {
    id: row.id,
    version: row.version,
    hourlyRateMinor: row.hourly_rate_minor,
    currency: row.currency,
    vatMode: row.vat_mode,
    absenceRule: row.absence_rule,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

function rowToLineRow(row: LineRow): FeeLineRow {
  return {
    meetingId: row.meeting_id,
    partnerProfileId: row.partner_profile_id,
    partnerName: row.partner_name,
    startsAt: row.starts_at,
    meetingStatus: row.meeting_status,
    durationMinutes: row.duration_minutes,
    prepMinutes: row.prep_minutes,
    registeredStatus: row.registered_status,
  };
}

/** Alle regelversioner, nyeste først (admin og partnere — RLS afgør). */
export async function listFeeRules(
  env: Record<string, string | undefined> = process.env,
): Promise<FeeRule[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("fee_rule")
    .select(RULE_COLUMNS)
    .order("version", { ascending: false });
  if (error) {
    console.error(`[fees] listFeeRules fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as RuleRow[]).map(rowToRule);
}

/**
 * Øvre grænse for linjer i én opgørelse. PostgREST afkorter stille ved sin egen grænse (1000); en
 * opgørelse eller eksport der mangler linjer uden at sige det, er værre end en fejl.
 */
export const FEE_LINE_LIMIT = 1000;

/** Opgørelsen ramte rækkegrænsen — fejl højlydt frem for at levere en afkortet opgørelse. */
export class FeeLinesTooManyError extends Error {
  constructor() {
    super(
      `Perioden har mindst ${FEE_LINE_LIMIT} honorarlinjer — opgørelsen er ikke vist, fordi den ville være afkortet. Vælg en kortere periode eller én partner.`,
    );
    this.name = "FeeLinesTooManyError";
  }
}

/**
 * Læs og beregn linjer. KASTER ved læsefejl (linjer ELLER regler) og ved rækkegrænsen: en
 * honoraropgørelse — og især CSV-eksporten til bogholderen — der stille er tom, afkortet eller
 * regnet uden regler ("ingen sats"), er værre end en fejl (sikkerhedsreview, samme greb som
 * `loadFeeTotals` og ADR 0053). Kun "Supabase ikke konfigureret" svarer [] (kontofri CI/dev).
 */
async function readLines(
  period: FeePeriodQuery,
  scope: { appUserId?: string; partnerId?: string },
  env: Record<string, string | undefined>,
): Promise<FeeLine[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  let query = supabase
    .from("partner_fee_line")
    .select(LINE_COLUMNS)
    .gte("starts_at", period.from)
    .lt("starts_at", period.to)
    .limit(FEE_LINE_LIMIT);
  if (scope.appUserId) query = query.eq("app_user_id", scope.appUserId);
  if (scope.partnerId) query = query.eq("partner_profile_id", scope.partnerId);

  const [lines, rules] = await Promise.all([
    query,
    supabase.from("fee_rule").select(RULE_COLUMNS).order("version", { ascending: false }),
  ]);
  if (lines.error) throw new Error(`Honorarlinjerne kunne ikke læses: ${lines.error.message}`);
  if (rules.error) throw new Error(`Honorarreglerne kunne ikke læses: ${rules.error.message}`);
  const rows = (lines.data ?? []) as unknown as LineRow[];
  if (rows.length >= FEE_LINE_LIMIT) throw new FeeLinesTooManyError();
  return buildFeeLines(
    rows.map(rowToLineRow),
    ((rules.data ?? []) as unknown as RuleRow[]).map(rowToRule),
  );
}

/**
 * Den nuværende partners egne honorarlinjer i perioden. Viewen scoper allerede til egne
 * rækker for en partner (RLS-laget); det eksplicitte `app_user_id`-filter her sikrer at en
 * bruger der også er admin ikke får ALLES under "mit honorar".
 */
export async function listMyFeeLines(
  period: FeePeriodQuery,
  env: Record<string, string | undefined> = process.env,
): Promise<FeeLine[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return [];
  return readLines(period, { appUserId: uid }, env);
}

export interface FeeTotalsOverview {
  totals: FeeTotals;
  /** Antal linjer der indgår (til at opdage rækkegrænsen). */
  lineCount: number;
  /** Antal honorarregel-versioner der findes — 0 betyder at satsen slet ikke er fastsat. */
  ruleCount: number;
}

/**
 * Honorar-tal for en periode til driftsoverblikket (fase 5.4, ADR 0055). Tager den authede
 * klient udefra og KASTER ved læsefejl — modsat `readLines`, der svarer [] — fordi et
 * driftsoverblik der viser "0 linjer" fordi forespørgslen fejlede, er værre end ingen tal
 * (ADR 0053). RLS afgør hvad klienten ser; for en ikke-admin giver viewen 0 rækker, så kaldstedet
 * skal selv kræve admin.
 */
export async function loadFeeTotals(
  db: SupabaseClient,
  period: FeePeriodQuery,
  rowLimit: number,
): Promise<FeeTotalsOverview> {
  const [lines, rules] = await Promise.all([
    db
      .from("partner_fee_line")
      .select(LINE_COLUMNS)
      .gte("starts_at", period.from)
      .lt("starts_at", period.to)
      .limit(rowLimit),
    db.from("fee_rule").select(RULE_COLUMNS).order("version", { ascending: false }),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  if (rules.error) throw new Error(rules.error.message);

  const lineRows = ((lines.data ?? []) as unknown as LineRow[]).map(rowToLineRow);
  const ruleList = ((rules.data ?? []) as unknown as RuleRow[]).map(rowToRule);
  const built = buildFeeLines(lineRows, ruleList);
  return {
    totals: summarizeFees(built.map((line) => line.result)),
    lineCount: lineRows.length,
    ruleCount: ruleList.length,
  };
}

/** Alle partneres honorarlinjer i perioden (admin — for en ikke-admin giver viewen 0 rækker). */
export async function listFeeLines(
  period: FeePeriodQuery & { partnerId?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<FeeLine[]> {
  return readLines(period, { partnerId: period.partnerId }, env);
}
