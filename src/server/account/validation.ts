/**
 * Kontoprofilens rene regler (skive K, ADR 0061): navn, telefon og tidszone. (SMS-samtykket er
 * fjernet — det er en del af kontrakten, ADR 0065.)
 * Ingen I/O og ingen Supabase — formularens input kommer ind som tekst og går ud som en
 * valideret, normaliseret værdi (eller en dansk fejl). Databasen (0024) har de samme former som
 * constraints; appen er den der giver brugeren en læsbar besked FØR databasen afviser.
 */

/** Tidszonen en konto har, indtil brugeren vælger en anden (kolonnens default, 0024). */
export const DEFAULT_TIME_ZONE = "Europe/Copenhagen";

export const DISPLAY_NAME_MAX = 100;

/** E-164: '+', landekode 1-9, i alt 7-15 cifre. Spejler `app_user_phone_e164_format` (0024). */
export const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

/**
 * Tidszonerne formularen tilbyder. En UDVALGT liste til selve valget (de relevante for danske
 * ejere og deres udland) — ikke en forretningsregel: ethvert gyldigt IANA-navn gemmes, og en
 * konto der allerede har en anden zone beholder den i vælgeren (`timeZoneChoices`).
 */
export const TIME_ZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Europe/Copenhagen", label: "Danmark (København)" },
  { value: "Atlantic/Faroe", label: "Færøerne" },
  { value: "America/Nuuk", label: "Grønland (Nuuk)" },
  { value: "Europe/Stockholm", label: "Sverige (Stockholm)" },
  { value: "Europe/Oslo", label: "Norge (Oslo)" },
  { value: "Europe/Berlin", label: "Tyskland (Berlin)" },
  { value: "Europe/London", label: "Storbritannien (London)" },
  { value: "Europe/Helsinki", label: "Finland (Helsinki)" },
  { value: "America/New_York", label: "USA, østkyst (New York)" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "UTC", label: "UTC" },
];

/** Vælgerens muligheder: listen, plus kontoens egen zone hvis den ikke står der. */
export function timeZoneChoices(current: string): ReadonlyArray<{ value: string; label: string }> {
  if (TIME_ZONE_OPTIONS.some((option) => option.value === current)) return TIME_ZONE_OPTIONS;
  return [{ value: current, label: current }, ...TIME_ZONE_OPTIONS];
}

/**
 * Er navnet en tidszone som tz-databasen kender? `Intl` afviser et ukendt navn med RangeError —
 * den sikreste kilde, fordi det er den samme database der senere formaterer tider. Formen
 * tjekkes først (samme form som databasens constraint), så `Intl`s lempelige tolkning af fx
 * "+01:00" eller små/store bogstaver aldrig slipper en værdi igennem som databasen ville afvise.
 */
export function isValidTimeZone(value: string): boolean {
  if (!/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("da-DK", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Trim og saml mellemrum; tomt navn er "ikke angivet" (null). */
export function normaliseDisplayName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length === 0 ? null : name;
}

export type PhoneResult = { ok: true; phone: string | null } | { ok: false; error: string };

const PHONE_HELP = "Skriv nummeret som +45 12 34 56 78, eller med landekode og + for udenlandske numre.";

/**
 * Normalisér et indtastet telefonnummer til E.164.
 *
 *  - Tomt → `null` (intet nummer).
 *  - Mellemrum, bindestreger, punktummer og parenteser ignoreres.
 *  - `+…` og `00…` er allerede internationale og valideres som E.164.
 *  - Præcis 8 cifre er et dansk nummer: `+45` sættes foran. Danske numre starter med 2-9 (planen
 *    har ikke 0 og 1 som første ciffer), så et 8-cifret tal der starter med 0/1 afvises i stedet
 *    for at blive til noget der ligner et nummer.
 *  - Alt andet (fx "4512345678" uden +) er flertydigt og afvises med en vejledning frem for at
 *    blive gættet.
 */
export function normalisePhone(raw: string): PhoneResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, phone: null };

  if (/[^\d\s().+-]/.test(trimmed)) {
    return { ok: false, error: `Telefonnummeret må kun indeholde cifre og +. ${PHONE_HELP}` };
  }
  const compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.lastIndexOf("+") > 0) {
    return { ok: false, error: `Plustegnet må kun stå forrest i telefonnummeret. ${PHONE_HELP}` };
  }

  let international: string;
  if (compact.startsWith("+")) {
    international = compact;
  } else if (compact.startsWith("00")) {
    international = `+${compact.slice(2)}`;
  } else if (/^\d{8}$/.test(compact)) {
    if (!/^[2-9]/.test(compact)) {
      return {
        ok: false,
        error: "Et dansk telefonnummer starter med 2-9. Tjek nummeret, eller skriv landekode med +.",
      };
    }
    international = `+45${compact}`;
  } else {
    return { ok: false, error: `Kan ikke se hvilket land nummeret hører til. ${PHONE_HELP}` };
  }

  if (!E164_PATTERN.test(international)) {
    return { ok: false, error: `Telefonnummeret er ikke et gyldigt internationalt nummer. ${PHONE_HELP}` };
  }
  return { ok: true, phone: international };
}

/** Hvad en bruger har skrevet i kontoformularen. */
export interface ProfileFormInput {
  displayName: string;
  phone: string;
  timeZone: string;
}

/** Den validerede profil, klar til at skrive. */
export interface ValidProfile {
  displayName: string | null;
  phone: string | null;
  timeZone: string;
}

export type ProfileResult = { ok: true; profile: ValidProfile } | { ok: false; error: string };

export function parseProfileInput(input: ProfileFormInput): ProfileResult {
  const displayName = normaliseDisplayName(input.displayName);
  if (displayName !== null) {
    if (displayName.length > DISPLAY_NAME_MAX) {
      return { ok: false, error: `Navnet må højst være ${DISPLAY_NAME_MAX} tegn.` };
    }
    if (/[\u0000-\u001f\u007f]/.test(displayName)) {
      return { ok: false, error: "Navnet må ikke indeholde styretegn." };
    }
  }

  const phone = normalisePhone(input.phone);
  if (!phone.ok) return phone;

  const timeZone = input.timeZone.trim();
  if (!isValidTimeZone(timeZone)) {
    return { ok: false, error: "Vælg en gyldig tidszone." };
  }

  return { ok: true, profile: { displayName, phone: phone.phone, timeZone } };
}
