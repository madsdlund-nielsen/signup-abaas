/**
 * Business-data-access for prisregler (Fase 3, ADR 0030). Læsning via authed klient —
 * RLS: den AKTIVE version er læsbar for alle authed (client-side prisberegner, §5.9);
 * alle versioner kun for admin. Writes i ./actions (service-role bag admin).
 * Ukonfigureret Supabase → null/[] (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import type { PricingRuleInput } from "./algorithm";

export * from "./algorithm";

export interface PricingRule extends PricingRuleInput {
  isActive: boolean;
  createdAt: string;
}

interface RuleRow {
  id: string;
  version: number;
  base_amount_minor: number;
  per_partner_amount_minor: number;
  factor_4_weeks: string | number;
  factor_8_weeks: string | number;
  factor_12_weeks: string | number;
  currency: string;
  is_active: boolean;
  created_at: string;
}

const RULE_COLUMNS =
  "id, version, base_amount_minor, per_partner_amount_minor, factor_4_weeks, factor_8_weeks, factor_12_weeks, currency, is_active, created_at";

// numeric-kolonner kommer som strenge fra PostgREST — parses eksplicit.
function rowToRule(row: RuleRow): PricingRule {
  return {
    id: row.id,
    version: row.version,
    baseAmountMinor: row.base_amount_minor,
    perPartnerAmountMinor: row.per_partner_amount_minor,
    factor4Weeks: Number(row.factor_4_weeks),
    factor8Weeks: Number(row.factor_8_weeks),
    factor12Weeks: Number(row.factor_12_weeks),
    currency: row.currency,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Den aktive prisregel, eller null — null betyder at prisen ikke er fastsat endnu. */
export async function getActivePricingRule(
  env: Record<string, string | undefined> = process.env,
): Promise<PricingRule | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("pricing_rule")
    .select(RULE_COLUMNS)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[pricing] getActivePricingRule fejlede: ${error.message}`);
    return null;
  }
  return rowToRule(data as unknown as RuleRow);
}

/** Alle versioner, nyeste først (admin — RLS afgør). */
export async function listPricingRules(
  env: Record<string, string | undefined> = process.env,
): Promise<PricingRule[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("pricing_rule")
    .select(RULE_COLUMNS)
    .order("version", { ascending: false });
  if (error) {
    console.error(`[pricing] listPricingRules fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as RuleRow[]).map(rowToRule);
}
