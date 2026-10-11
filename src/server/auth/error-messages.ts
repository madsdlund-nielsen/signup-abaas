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
  // Supabase' HIBP-tjek (leaked password protection). Slås til i dashboardet, ikke i kode —
  // oversættelsen ligger her, så brugeren ikke møder en engelsk fejl den dag flaget vendes.
  if (
    m.includes("easy to guess") ||
    m.includes("known to be weak") ||
    m.includes("pwned") ||
    m.includes("compromised")
  ) {
    return "Adgangskoden optræder i kendte datalæk — vælg en anden.";
  }
  // Skal stå FØR «password should be»: Supabase' tekst her («New password should be different from
  // the old password») ville ellers fejlagtigt blive oversat til «for kort».
  if (m.includes("different from the old password") || m.includes("same_password")) {
    return "Vælg en adgangskode, du ikke har brugt før.";
  }
  if (m.includes("password should be") || m.includes("password is too short")) {
    return "Adgangskoden er for kort — brug mindst 8 tegn.";
  }
  return "Noget gik galt. Prøv igen — kontakt support hvis det fortsætter.";
}
