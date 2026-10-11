# 0070 — Sikkerhedsheadere, nonce-CSP, fejlsider og tilgængelighedsgate

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 6 (§6.2 sikkerhedsgennemgang) + design som acceptkriterium
- **Supplerer:** ADR 0020 (adgangsporten i proxyen), ADR 0049 (proxyen holdes billig), ADR 0050 (nav'en streames)
- **Berører uafklaret punkt:** nej. Ingen forretnings-, pris-, jura- eller leverandørbeslutning;
  den ene leverandørnære konsekvens (Google Fonts) er flaget i B-81 og ikke truffet her

## Kontekst

Appen sendte ingen sikkerhedsheadere og havde hverken 404-side, fejlside eller en
tilgængelighedsvagt. Fase 6.2 kræver en sikkerhedsgennemgang, og ejerne dømmer platformen
på om den *føles* high-end — også når noget går galt. Tre afgrænsede ting, ét sted.

## 1. Headere

| Header | Værdi | Begrundelse |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | To år (preload-kravet), men **uden** `preload`: det er en forpligtelse for hele domænet og et domænevalg der ikke er truffet (signupacademy.com afventer). Browsere ignorerer headeren over http |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` + `frame-ancestors 'none'` | `DENY` | Ingen side skal indrammes. Begge sættes: `frame-ancestors` er standarden, XFO dækker ældre browsere |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Standarden. **`/vurdering/*` får `no-referrer`** (ADR 0060: tokenet står i stien) — både som header og i sidens egen `<meta>` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(), browsing-topics=()` | Cal Video åbnes som **eget dokument** via et link (`video_join_url`); `/moeder/rum/[ref]` er en demo-side uden medier. Ingen side i appen behøver kamera eller mikrofon. Indlejres Cal Video en dag som iframe, skal `frame-src` og denne politik udvides i samme PR |
| `Content-Security-Policy` | se nedenfor | |
| (`/api/*`) | `default-src 'none'; frame-ancestors 'none'` | API-svar er data, aldrig dokumenter |

Alle statiske headere bor i `src/server/security/headers.ts` og sættes via `headers()` i
`next.config.ts`. Modulet er rent (ingen `next/*`, ingen `node:*`), så det også kan bruges
af proxyen og testes uden rammeværk.

## 2. Content-Security-Policy med nonce

Next 16's anbefalede mønster: proxyen genererer en nonce pr. request (Web Crypto, 128 bit),
sætter `Content-Security-Policy` på **både** request og svar, og Next stempler nonce'n på
sine egne scripts og styles under server-rendering.

```
default-src 'self';
script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'nonce-…' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self';
frame-src 'none'; media-src 'self'; worker-src 'self' blob:; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests   (kun over https)
```

**Domænelisten er målt, ikke gættet.** Browseren taler i dag kun med appens egen oprindelse:
Supabase (`@supabase/ssr` kører kun på serveren og i proxyen — der findes ingen
`createBrowserClient`), Alunta, Cal.com, Ordbogen, Resend, inMobile og PostHogs Query API
kaldes alle server-side. Der er **ingen browser-side PostHog-klient** og **intet cookie-banner
i koden endnu** (CLAUDE.md: «banneret bliver», 2026-10-11) — så `connect-src` er `'self'`, ikke
Supabase-URL'en og ikke PostHog EU. Bygges banneret og et browser-SDK, SKAL deres domæner
(`eu.i.posthog.com`, `eu-assets.i.posthog.com`, evt. Supabase-URL'en) tilføjes i
`headers.ts` i samme PR, og a11y-gaten (§4) udvides med banneret.

De bevidste huller, og hvorfor:

- **`style-src-attr 'unsafe-inline'`** — `next/image` skriver `style="color:transparent"`, og
  `Card`, `PartnerCard` og `OnboardingFlow` har små `style`-attributter (baggrundsbillede,
  fremdriftsbredde). Attributter kan ikke bære nonce. Hullet er afgrænset til attributter:
  inline `<style>`-elementer kræver stadig nonce, så det åbner ikke for CSS-injektion af
  elementer og lukker ikke af for script-reglerne. De tre komponenter er et brud på reglen
  «ingen inline styles» og kunne en dag flyttes til CSS-variabler (B-83).
- **`https://fonts.googleapis.com` / `https://fonts.gstatic.com`** — Open Sans hentes i dag via
  `@import` i `globals.css`. Det er en US-leverandør der modtager besøgendes IP; det står ikke
  i leverandørregistret. Self-hosting fjerner begge linjer og et GDPR-punkt, men ændrer
  font-pipelinen og er derfor ikke gjort her — **B-81**.
- **`img-src https:`** — partnerportrætter er en fri URL i `partner_profile.photo_url`; værten
  er ikke kendt. Lukkes når billederne ligger i Supabase Storage — **B-82**.

### Nonce kræver dynamisk rendering — og det er allerede tilfældet

Next sætter kun nonce på det det selv genererer under *request-time*-rendering; en statisk
prærenderet side sender scripts uden nonce, som CSP'en så blokerer. Med Supabase-nøgler
(som på Netlify) var hver rute allerede dynamisk (ADR 0050), men uden nøgler var `/`, `/login`,
`/signup`, `/styleguide` og `/_not-found` statiske — og ville have været brudt i CI og lokalt.
Rodlayoutet er derfor `async` og kalder `await connection()`. Det koster **ingen netværkstur**
(i modsætning til sessionsopslaget ADR 0050 fjernede) og ændrer ikke at nav'en streames bag
sin Suspense-grænse. Prisen: ingen statisk prærendering og intet CDN-cache af HTML — hvilket
B-27 allerede registrerer som tilstanden i produktion. Partial Prerendering er uforeneligt
med nonce-CSP (Next-dokumentationen); den dag Cache Components genovervejes (ADR 0050, A),
skal CSP'en skifte til SRI/hash i stedet.

### Håndhævet — ikke Report-Only

Opgaven tillod Report-Only hvis nonce-CSP ikke kunne få streaming til at virke rent. Det
kunne den: `next build && next start` + Chromium på `/`, `/login`, `/signup`, `/styleguide`,
`/gate`, `/vurdering/…` og en 404 giver **0 CSP-overtrædelser**, ingen scripts uden nonce,
hydrering lykkes, og `Suspense`-streamingen af nav'en (ADR 0050) virker. Et inline-`onerror`
og et `fetch` til en fremmed oprindelse blokeres som de skal.

**Nødbremse:** `CSP_REPORT_ONLY=true` (Netlify env var) skifter header-navnet til
`Content-Security-Policy-Report-Only` — samme politik, men den blokerer intet. Den er til
den dag en ny integration viser sig at kalde et domæne vi ikke kender, ikke til drift.

### Proxyen

Sessionsopfriskningen (ADR 0014) genopbygger svaret når den skriver cookies. CSP'en lægges
derfor i en fabrik (`cspResponder`), og request-headerne læses *friske* hver gang — ellers ville
de opfriskede auth-cookies ikke nå serverkomponenterne. Det er låst fast i en integrationstest.
Adgangsportens redirect (ADR 0020) er uændret og kører først. Matcheren er uændret
(`proxy-matcher.test.ts` er urørt), så `/api` er stadig udenfor og får sin egen strenge CSP via
`headers()`.

### Åbent og ikke verificeret

- **`form-action 'self'` og betalings-checkout.** `memberships/actions.ts` ender i
  `redirect(checkoutUrl)` (Alunta/QuickPay, ekstern). Med JavaScript er det en klient-navigation
  og uberørt af `form-action`; en formular sendt *før hydrering* ville blive blokeret af
  Chrome ved redirect til en ekstern værts. Sjælden, men uverificeret mod en rigtig checkout —
  **B-84** (`TODO(mads)` når Alunta-test_mode er sat op).
- **Netlify.** Headerne er verificeret lokalt med `next start`. At Netlify-runtimen leverer
  både `headers()` og proxyens CSP uændret på `sua-abaas.netlify.app` er ikke set — tjek med
  `curl -I` på første deploy (B-84).

## 3. Fejlsider

`src/app/not-found.tsx`, `src/app/error.tsx` (klient, `retry`) og `src/app/global-error.tsx`,
alle på den fælles `ErrorPage` — charcoal hero-bånd, tynd h1, guld eyebrow, rolig dansk tekst
og et link hjem. **Ingen ny CSS**: kun eksisterende bånd-, overskrifts- og knaptokens.

- Aldrig `error.message` eller stacktrace i UI'et (serverfejl er anonymiseret i produktion,
  klientfejl kan indeholde det vi ikke vil vise). Fejlen logges i konsollen; Nexts `digest`
  vises som «Fejlreference» så support kan slå den op i serverloggen.
- `global-error` erstatter rodlayoutet, så den bringer sit eget `<html lang="da">`, sine egne
  stylesheets og et hårdt link hjem (`<a>`, ikke `Link` — en soft-navigation ville beholde det
  ødelagte layout).
- Next 16.3 kalder prop'en `retry` (genhenter og gen-renderer segmentet); `reset` rydder blot
  fejltilstanden. Vi bruger `retry`.

## 4. Tilgængelighedsgate

- **`axe-core`** (dev) kører i enhedstestene (`tests/unit/a11y.test.tsx`) mod PageHeader/PageBody,
  header + fod + topbar, formularer (`Field`, `AuthForm`), alle tre rolle-dashboards og lead-
  oversigten, driftsoverblikket, honoraropgørelsen, notifikationsoversigten og -editoren,
  forsiden og fejlsiderne. Der er en test af at gaten virker (et umærket felt og en navnløs knap
  *fejler*), så grønne tests betyder noget.
- **Kontrast** kan axe ikke måle i jsdom. `tests/unit/contrast.test.ts` regner WCAG-forholdet
  direkte på `design-tokens.css`: kombinationer der SKAL bestå AA, og en liste af **kendte hul**
  (målt og registreret, B-80) der fejler den dag de lukkes, så listen holdes ærlig.
  Samme fil forbyder slate/stålblå som tekstfarve og `outline: none`.
- **Chromium mod en produktionsbygning** (axe med farvekontrast) fandt det jsdom ikke kunne:

| Fund | Handling |
|---|---|
| Forside og styleguide havde intet `<main>` | **Rettet** (`<main id="main">`) |
| Kontaktbaren stod uden for alle landmarks | **Rettet** (`role="region"`, navngivet) |
| Ingen «Spring til indhold» | **Rettet** (`.skiplink`, mål `#main` på alle sider) |
| Ingen global fokusmarkering; felters fokusring var guld (2,8:1 mod hvid) | **Rettet** (`:focus-visible` navy / hvid på mørke flader, ≥ 3:1) |
| Fem tekstfarver i `slate` (4,0:1) | **Rettet** → `--color-text-muted` (8,3:1) |
| Styleguiden sprang fra h1 til h3 | **Rettet** |
| **Guld som tekst og som CTA-fyld under AA** (2,8:1 på hvid, hvid på guld 2,8:1, guld på navy 4,3:1) | **Ikke rettet** — designvalg, **B-80** |

Guld er brandets accent (CLAUDE.md: «guld som sparsom accent», signupacademy.com's CTA), så
en mørkere tekst-/knapvariant er Mads' valg, ikke Claude Codes. Dokumentet viser to varianter
i B-80 frem for at beslutte.

## Konsekvenser

- **Positive:** CSP uden `unsafe-inline` for scripts (XSS-formildende), clickjacking lukket,
  rating-tokenet kan ikke lække via Referer, kamera/mikrofon/lokation kan ikke aktiveres af
  injiceret indhold, fejl føles som resten af huset, og tilgængelighed er en CI-gate.
- **Negative / pris:** ingen statisk prærendering (allerede tilstanden i produktion); en ny
  tredjeparts-integration i browseren *skal* tilføjes i `headers.ts`, ellers blokeres den
  — bevidst, og testen af domænelisten vil fejle og pege på stedet.
- **Opfølgning:** B-80…B-85 i `docs/backlog.md`.
