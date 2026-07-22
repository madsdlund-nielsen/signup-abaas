/**
 * Oversætter Supabase Auth' (engelske) fejlbeskeder til pæne danske brugerbeskeder.
 * Ren funktion — enhedstestet i tests/unit/auth-errors.test.ts. Ukendte fejl får en
 * generisk besked (den rå fejl logges server-side af kaldstedet, ikke her).
 */
export function translateAuthError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes("rate limit")) {
    return "For mange forsøg lige nu — vent et øjeblik og prøv igen.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "Denne e-mail er allerede registreret. Log ind i stedet.";
  }
  if (m.includes("invalid login credentials")) {
    return "Forkert e-mail eller adgangskode.";
  }
  if (m.includes("email not confirmed")) {
    return "Din e-mail er ikke bekræftet endnu — tjek din indbakke.";
  }
  if (m.includes("password should be") || m.includes("password is too short")) {
    return "Adgangskoden er for kort — brug mindst 8 tegn.";
  }
  return "Noget gik galt. Prøv igen — kontakt support hvis det fortsætter.";
}
