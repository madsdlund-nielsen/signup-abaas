/**
 * Læsevejene bag rolle-dashboardene (fase 5.4, ADR 0055). Det meste af et dashboard samles af
 * eksisterende RLS-scopede funktioner (getMyBoard, listMyMeetings, getMyMembership, …) direkte
 * på siden. Her bor kun det der ikke findes andre steder:
 *
 *   - `getLeadBoardNeeds` — ejerens kompetencebehov til lead-partnerens overblik. Dette er en
 *     NY læsevej: RLS giver kun ejeren (og admin) adgang til `quiz_answer`
 *     (`quiz_answer_select_owner`, 0008), så en partner — heller ikke lead — kan ikke læse
 *     behovene selv. Vi åbner IKKE RLS (ingen ny policy, ingen migration); i stedet læses der
 *     via service-role bag et eksplicit "er lead på DETTE board"-tjek, og kun tag-id'er forlader
 *     funktionen. Begrundelsen står i ADR 0055.
 *   - `getMyMonthFees` — partnerens honorar i indeværende måned.
 *
 * Ukonfigureret Supabase → null (kontofri CI/dev).
 */

import { getCurrentUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { readOwnerTagIds } from "@/server/matching/owner-needs";
import {
  listFeeRules,
  listMyFeeLines,
  monthOf,
  monthPeriod,
  summarizeFees,
  type FeeTotals,
} from "@/server/fees";

export * from "./coverage";
export * from "./meetings";

export interface LeadBoardNeeds {
  boardId: string;
  /** Ejerens behovs-tags (unikke). Kun id'er — aldrig svarmuligheder eller fritekst. */
  ownerTagIds: string[];
}

/**
 * Ejerens kompetencebehov for et board, til lead-partneren på netop det board.
 *
 * Rækkefølgen er sikkerheden: (1) hvem er brugeren — fra sessionen, aldrig fra input;
 * (2) har brugeren en katalogprofil; (3) er profilen LEAD på `boardId`. Først derefter røres
 * `quiz_answer`. Svarer brugeren ikke på alle tre, returneres null og der læses intet.
 * Fejl i selve behovslæsningen kaster ikke — null (og et log uden persondata): et dashboard
 * der ikke kan læse behovene må ikke se ud som om ejeren ingen behov har.
 *
 * TODO(ejer): lead-tildeling er uafklaret (byggespec §12 pkt. 15). Tjekket her hviler på
 * `board_partner.is_lead` som den står i data — uanset om markeringen er tændt i UI'et
 * (flaget `leadPartner`).
 * At boardets lead ser ejerens kompetencebehov er dækket af kontrakten (Mads, 2026-10-11,
 * ADR 0065) — der er ingen separat opt-in/informering på platformen. Kontraktens ordlyd er
 * ejerens (ToS), se `src/server/admin/legal.ts`.
 */
export async function getLeadBoardNeeds(
  boardId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<LeadBoardNeeds | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const user = await getCurrentUser(env);
  if (!user || !user.roles.includes("partner")) return null;

  const service = createServiceSupabase(config);

  const profile = await service
    .from("partner_profile")
    .select("id")
    .eq("app_user_id", user.id)
    .maybeSingle();
  if (profile.error || !profile.data) {
    if (profile.error) console.error(`[dashboard] profil-opslag fejlede: ${profile.error.message}`);
    return null;
  }
  const partnerProfileId = (profile.data as { id: string }).id;

  const lead = await service
    .from("board_partner")
    .select("board_id")
    .eq("board_id", boardId)
    .eq("partner_id", partnerProfileId)
    .eq("is_lead", true)
    .maybeSingle();
  if (lead.error || !lead.data) {
    if (lead.error) console.error(`[dashboard] lead-tjek fejlede: ${lead.error.message}`);
    return null;
  }

  const board = await service.from("board").select("owner_id").eq("id", boardId).maybeSingle();
  if (board.error || !board.data) {
    if (board.error) console.error(`[dashboard] board-opslag fejlede: ${board.error.message}`);
    return null;
  }
  const ownerId = (board.data as { owner_id: string }).owner_id;

  // Samme læsning som admins board-editor (ADR 0062): fælles hjælper, kun tag-id'er forlader den.
  const ownerTagIds = await readOwnerTagIds(service, ownerId);
  if (ownerTagIds === null) return null;
  return { boardId, ownerTagIds };
}

export interface MonthFees {
  /** "ÅÅÅÅ-MM" (dansk tid). */
  month: string;
  totals: FeeTotals;
  /** Findes der overhovedet en honorarregel? Uden den er intet beløb beregneligt. */
  hasRules: boolean;
}

/** Partnerens egne honorarlinjer i `now`s måned, samlet til de tal dashboardet viser. */
export async function getMyMonthFees(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<MonthFees> {
  const period = monthPeriod(monthOf(now));
  const [lines, rules] = await Promise.all([listMyFeeLines(period, env), listFeeRules(env)]);
  return {
    month: period.month,
    totals: summarizeFees(lines.map((line) => line.result)),
    hasRules: rules.length > 0,
  };
}
