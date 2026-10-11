/**
 * Hvad browser-PostHog må se af en adresse (ADR 0072). Rent modul — testes uden SDK.
 *
 * Adresser kan bære persondata og hemmeligheder: den signerede rating-rute har tokenet i STIEN
 * (`/vurdering/<token>`, ADR 0060), auth-redirects har koder i forespørgslen, og mødesider har
 * et id. Derfor sendes aldrig forespørgsel eller fragment, rating-tokenet erstattes, og
 * UUID'er i stien erstattes med `[id]`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";

export function sanitizePath(pathname: string): string {
  const segments = pathname.split("/");
  const out = segments.map((segment, i) => {
    if (UUID.test(segment)) return "[id]";
    if (segments[i - 1] === "vurdering" && segment !== "") return "[token]";
    return segment;
  });
  return out.join("/") || "/";
}

/** Absolut eller relativ adresse → samme form uden forespørgsel/fragment og med skjulte id'er. */
export function sanitizeUrl(input: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(input);
    const url = new URL(input, PLACEHOLDER_ORIGIN);
    const path = sanitizePath(url.pathname);
    return absolute ? `${url.origin}${path}` : path;
  } catch {
    return "";
  }
}

const URL_KEYS = [
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_referrer",
  "$initial_current_url",
  "$initial_pathname",
];
const PATH_KEYS = new Set(["$pathname", "$initial_pathname"]);

type Props = Record<string, unknown>;

function scrub(props: Props): Props {
  const next: Props = { ...props };
  for (const key of URL_KEYS) {
    const value = next[key];
    if (typeof value !== "string" || value === "" || value === "$direct") continue;
    next[key] = PATH_KEYS.has(key) ? sanitizePath(value) : sanitizeUrl(value);
  }
  return next;
}

interface EventLike {
  properties?: Props;
  $set?: Props;
  $set_once?: Props;
}

/**
 * `before_send` til posthog-js (afløser det forældede `sanitize_properties`): renser adresserne i
 * hændelsens egenskaber samt `$set`/`$set_once`. Returnerer altid hændelsen — vi dropper ingen.
 */
export function sanitizeEvent<T extends EventLike>(event: T | null): T | null {
  if (!event) return event;
  const next: T = { ...event };
  for (const key of ["properties", "$set", "$set_once"] as const) {
    const value = next[key];
    if (value && typeof value === "object") next[key] = scrub(value);
  }
  return next;
}
