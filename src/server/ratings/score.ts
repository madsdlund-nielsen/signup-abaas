/**
 * Skalaen og dens validering (fase 4.2, ADR 0038). Ren — ingen env, ingen Supabase — så både den
 * indloggede vurdering (`actions.ts`) og engangslinket (`link-service.ts`, ADR 0060) bruger
 * præcis samme regel.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Et helt tal på skalaen, ellers `null`. Tom streng og tekst er ugyldige, ikke 0. */
export function parseScore(raw: string): number | null {
  if (raw.trim() === "") return null;
  const score = Number(raw);
  if (!Number.isInteger(score) || score < RATING_MIN || score > RATING_MAX) return null;
  return score;
}
