/**
 * Sikkerhedsheadere og Content-Security-Policy (fase 6.2, ADR 0070).
 *
 * Rent modul uden afhængigheder — det importeres BÅDE af `next.config.ts` (statiske headere)
 * og af `src/proxy.ts` (CSP med nonce pr. request), og af tests. Ingen `next/*`, ingen `node:*`:
 * proxyen kan køre uden for Node, så nonce'n laves med Web Crypto + `btoa`.
 *
 * Domænelisten nedenfor er ikke et skøn: den er det appen FAKTISK kalder fra browseren, målt
 * ved at gennemgå koden (ADR 0070). Browseren taler som udgangspunkt kun med appens egen
 * oprindelse — Supabase, Alunta, Cal.com, Ordbogen, Resend, inMobile og PostHog-læsning kaldes
 * alle server-side. Eneste undtagelse er browser-PostHog (ADR 0072): dets EU-domæner åbnes KUN
 * når `posthog` er sat (analytics slået til + browser-nøgle), og SDK'et initialiseres først
 * efter samtykke. Kommer der endnu et browser-SDK til, SKAL dets domæne tilføjes her i samme PR.
 */

/** Google Fonts (CSS + filer). TODO(mads): selv-host Open Sans og fjern begge — se backlog B-81. */
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

/**
 * PostHog EU (ADR 0072): ingest (`connect-src`) og statiske filer/konfiguration (`script-src`
 * som fallback; med `strict-dynamic` ignorerer moderne browsere værtslisten). Spejler
 * POSTHOG_BROWSER_HOST/POSTHOG_ASSETS_HOST i `src/lib/analytics/browser-config.ts` — dette
 * modul har bevidst ingen imports, så værdierne gentages og en test låser dem sammen.
 */
export const POSTHOG_INGEST_ORIGIN = "https://eu.i.posthog.com";
export const POSTHOG_ASSETS_ORIGIN = "https://eu-assets.i.posthog.com";

export interface CspOptions {
  /** Base64-nonce, unik pr. request. */
  nonce: string;
  /** `next dev` kræver `unsafe-eval` (React-fejlsporing) og inline-styles til HMR. */
  isDev?: boolean;
  /** Åbn PostHog EU for browseren (ADR 0072). Sæt kun når browser-analytics er slået til. */
  posthog?: boolean;
  /** Kun når forbindelsen er https — ellers ville `next start` på localhost brydes. */
  upgradeInsecure?: boolean;
}

/** Tilfældig nonce, base64, 128 bit. Web Crypto, så den virker i enhver proxy-runtime. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Selve politikken. Direktiv for direktiv (begrundelse i ADR 0070):
 *  - script-src: nonce + strict-dynamic. Ingen `unsafe-inline` — det er hele pointen.
 *  - style-src: nonce + egne filer + Google Fonts' CSS. `style-src-attr 'unsafe-inline'` er et
 *    bevidst, afgrænset hul: `next/image` og et par komponenter skriver `style="…"`-attributter,
 *    og attributter kan ikke bære nonce. Det åbner ikke for inline <style>-elementer.
 *  - img-src: `https:` fordi partnerportrætter er en fri URL i `partner_profile.photo_url`
 *    (værten er ikke kendt på forhånd) — B-82.
 *  - connect-src 'self': se modulkommentaren. Med `posthog` desuden PostHog EU (ADR 0072).
 *  - frame-src 'none': Cal Video åbnes som eget vindue/fane via et link, ikke som iframe.
 */
export function buildCsp({
  nonce,
  isDev = false,
  upgradeInsecure = false,
  posthog = false,
}: CspOptions): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(isDev ? ["'unsafe-eval'"] : []),
        ...(posthog ? [POSTHOG_ASSETS_ORIGIN] : []),
      ],
    ],
    [
      "style-src",
      ["'self'", ...(isDev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`]), GOOGLE_FONTS_CSS],
    ],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", GOOGLE_FONTS_FILES]],
    ["connect-src", ["'self'", ...(posthog ? [POSTHOG_INGEST_ORIGIN, POSTHOG_ASSETS_ORIGIN] : [])]],
    ["frame-src", ["'none'"]],
    ["media-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headernavnet. `CSP_REPORT_ONLY=true` er nødbremsen: samme politik, men den blokerer intet. */
export function cspHeaderName(env: Record<string, string | undefined> = process.env): string {
  return env.CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Kamera, mikrofon og lokation er slået fra: videomødet åbnes hos Cal Video (eget dokument,
 * egen politik) via et link, så ingen side i appen behøver dem. Slår vi Cal Video ind som
 * iframe en dag, SKAL `frame-src` og denne politik udvides (`camera=(self "https://…")`).
 */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

/** To år, som preload-listen kræver — men uden `preload`: det er en forpligtelse for hele domænet. */
export const HSTS = "max-age=63072000; includeSubDomains";

/** Headere der er ens på alle dokument-svar, uafhængigt af referrer-valget. */
const BASE_HEADERS: HeaderEntry[] = [
  { key: "Strict-Transport-Security", value: HSTS },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];

/** Den signerede rating-rute bærer tokenet i stien og må aldrig lække det som Referer (ADR 0060). */
export const NO_REFERRER_SOURCE = "/vurdering/:path*";
/** Alt andet end rating-ruten (negativ lookahead, så reglerne ikke overlapper). */
export const DEFAULT_REFERRER_SOURCE = "/((?!vurdering/).*)";

/** Til `headers()` i next.config.ts. */
export function staticHeaderRules(): Array<{ source: string; headers: HeaderEntry[] }> {
  return [
    {
      source: DEFAULT_REFERRER_SOURCE,
      headers: [...BASE_HEADERS, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
    },
    {
      source: NO_REFERRER_SOURCE,
      headers: [...BASE_HEADERS, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      // API-svar er JSON/tekst — de skal aldrig kunne udføre noget eller indrammes.
      // (Proxyen kører ikke på /api, så de får ingen nonce-CSP; denne er den strengeste mulige.)
      source: "/api/:path*",
      headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
    },
  ];
}
