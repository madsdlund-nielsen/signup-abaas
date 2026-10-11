/**
 * Adgangskodereglen i appen. Samme regel som signup (`minLength={8}` i /signup og beskeden i
 * `translateAuthError`) — her samlet ét sted, så «sæt adgangskode» ikke opfinder en ny.
 * Supabase-projektets egen politik (minimumslængde, læk-tjek) er stadig det endelige værn og
 * oversættes af `translateAuthError`; dette er blot en hurtig, dansk afvisning før kaldet.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Fejlbesked, eller null hvis adgangskoden og gentagelsen er acceptable. */
export function validateNewPassword(password: string, repeat: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Adgangskoden er for kort — brug mindst ${PASSWORD_MIN_LENGTH} tegn.`;
  }
  if (password !== repeat) return "De to adgangskoder er ikke ens.";
  return null;
}
