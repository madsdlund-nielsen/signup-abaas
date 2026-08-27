/**
 * Ren aggregeringslogik for mødevurderinger (fase 4.2). Adskilt fra ./index af samme grund
 * som pricing/algorithm og matching/algorithm: ingen Supabase-import, så funktionen kan
 * unit-testes direkte uden at trække next/headers eller en klient med ind.
 *
 * Aggregeringen sker her frem for i SQL. Datamængden er lille (én række pr. vurderet partner
 * pr. møde), og alternativet — en database-VIEW — ville skulle bære sin egen RLS-historik for
 * at være sikker. Bliver det for stort, er en materialiseret aggregering en senere
 * optimering, ikke en forudsætning.
 */

export interface PartnerRatingSummary {
  partnerProfileId: string;
  name: string;
  count: number;
  /** Gennemsnit, afrundet til én decimal. Null hvis der ingen vurderinger er. */
  average: number | null;
}

/** Formen Supabase returnerer: den indlejrede relation kan være objekt eller array. */
export interface RatingSummaryRow {
  subject_partner_profile_id: string;
  score: number;
  partner_profile: { name: string } | Array<{ name: string }> | null;
}

/** Aggregér vurderinger pr. vurderet partner, sorteret på navn (dansk kollation). */
export function summarise(rows: RatingSummaryRow[]): PartnerRatingSummary[] {
  const byPartner = new Map<string, { name: string; scores: number[] }>();

  for (const row of rows) {
    const profile = Array.isArray(row.partner_profile)
      ? row.partner_profile[0]
      : row.partner_profile;
    const entry = byPartner.get(row.subject_partner_profile_id) ?? {
      name: profile?.name ?? "Ukendt partner",
      scores: [],
    };
    entry.scores.push(row.score);
    byPartner.set(row.subject_partner_profile_id, entry);
  }

  return [...byPartner.entries()]
    .map(([partnerProfileId, { name, scores }]) => ({
      partnerProfileId,
      name,
      count: scores.length,
      average:
        scores.length === 0
          ? null
          : Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "da-DK"));
}
