# 0072 — Cookie-banner og samtykke-gatet browser-PostHog

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 6 (§6.2 sikkerhed/GDPR) + 0 (samtykke som arkitektur-hook, Trin 10)
- **Supplerer:** 0065 (cookie-samtykket er den bevidste undtagelse), 0066 (PostHog-læsning er server-side), 0070 (CSP og a11y-gate)
- **Berører uafklaret punkt:** ja, to — **samtykketeksten** (godkendes sammen med ToS) og
  **samtykkets levetid** (12 måneder er en teknisk default). Begge er markeret `TODO(ejer)` og står i
  stub-registret. Ingen leverandør-, pris- eller jurabeslutning er truffet her

## Kontekst

Mads afgjorde 2026-10-11 at cookie-banneret **bliver** (ADR 0065). Gennemgangen viste at det aldrig var
bygget: der fandtes kun den typede kerne (`src/server/consent/index.ts`), og PostHog kørte kun
server-side (ADR 0066). Appen satte derfor **ingen ikke-nødvendige cookies**, og der var intet at spørge om.
Skiven bygger banneret, et browser-PostHog der kun findes efter samtykke, og de to ting ADR 0070 pegede på:
CSP-domænerne og banneret i a11y-gaten (B-85, bannerdelen).

## Beslutning

### 1. Banneret findes kun når der er noget at spørge om

`readBrowserAnalyticsConfig()` (`src/lib/analytics/browser-config.ts`) svarer ja når **`FLAG_ANALYTICS` og
`NEXT_PUBLIC_POSTHOG_KEY`** begge er sat. Rodlayoutet renderer kun banner, SDK-binding og footerlink i det
tilfælde; ellers er sidens HTML uændret. Samme funktion styrer CSP'en (punkt 5), så de to ikke kan blive uenige.
Serverens `POSTHOG_KEY` er en anden nøgle og tæller ikke.

### 2. Banneret (`src/components/CookieBanner.tsx`, klient)

- **Ligeværdige valg:** «Kun nødvendige» og «Tillad analyse» er samme knaptype (`.btn-secondary`), samme
  størrelse, ingen guld, ingen forhåndsvalg. Intet «afvis» gemt bag et link. «Indstillinger» åbner kategorierne
  (nødvendige: fast til og ikke til at fravælge; analyse: fra som standard) og en «Gem valg»-knap.
- **Ikke en modal:** en fast region nederst (`role="region"`, `aria-labelledby`), der ikke fanger fokus og ikke
  blokerer siden. Den står lige efter «Spring til indhold» i DOM-rækkefølgen, så tastaturbrugere når den tidligt.
  Ved første indlæsning flyttes fokus ikke.
- **Tastatur:** ESC lukker indstillingerne og flytter fokus til «Indstillinger»; et andet ESC lukker en
  *genåbnet* banner (der er jo et valg). Ved første besøg gør ESC intet — et valg skal træffes, ikke fjernes.
  Efter et valg læser en `role="status"`-linje det op, og fokus går tilbage til det element der åbnede banneret.
- **Genåbning:** footerens «Cookie-indstillinger» (`CookieSettingsLink`, kun når banneret findes) sender et
  `window`-event. Banneret og SDK-bindingen taler også via et event (`CONSENT_CHANGED_EVENT`, kernen) frem for
  en delt wrapper — det holder `src/components/**` fri for `@/lib` (lint-regel, ADR 0002) uden at banneret skal
  kende leverandøren.
- **Kategorier:** kun dem der **faktisk sætter noget i dag**: nødvendige og analyse. `functional` findes i kernen,
  men ingen bruger den, så den vises ikke (en tom kategori at sige ja til er støj). Kommer der en funktionel
  cookie, udvides banneret og `docs/gdpr/cookies.md` i samme PR.
- **Tekst:** neutral og faktuel, ingen juridiske løfter («brugsstatistik over sidevisninger, uden personprofiler»
  — ikke «anonym»: cookie-id'et er pseudonymt). `TODO(ejer): samtykketekst — godkendes sammen med ToS`.

### 3. Hvor valget gemmes (kernen udvidet, med tests)

Førstepartscookien **`abaas_consent`** (`CONSENT_COOKIE`): `{functional, analytics}` URL-kodet, `Path=/`,
`SameSite=Lax`, `Secure` over https, **`Max-Age` 12 måneder** (`CONSENT_MAX_AGE_SECONDS`;
`TODO(ejer)` — teknisk default, ikke en juridisk afgørelse). Den er skrevet af klienten (`document.cookie`),
ikke httpOnly: serveren læser den ved rendering, så banneret ikke blinker og intet hydreringsmisforhold opstår;
indholdet er ikke følsomt. Den er klassificeret som **nødvendig** — den husker et nej.
Kernen fik `readConsentChoice` (returnerer `null` for «ikke valgt»; `parseConsent` kunne ikke skelne «ikke valgt»
fra «kun nødvendige»), `buildConsentCookie`, konstanterne og de to event-navne. `parseConsent`/`serializeConsent`
er uændrede.

### 4. Browser-PostHog (`src/lib/analytics/browser*.ts`, `BrowserAnalytics.tsx`)

- **Intet før samtykke.** `posthog-js` hentes med dynamisk `import()` og `init` kaldes først efter et aktivt
  `analytics`-valg. Før det: ingen SDK-kode i siden, ingen cookie/localStorage/sessionStorage, ingen request til
  PostHog. Verificeret i Chromium (se nedenfor). Et kapløb — samtykket trukket mens SDK'et hentes — initialiserer
  aldrig.
- **EU-host som konstant**, ikke env: `https://eu.i.posthog.com` (+ `ui_host` `https://eu.posthog.com`).
  Dataresidens skal ikke kunne skifte ved en tastefejl, og CSP'en skal kende præcis de samme domæner (en test
  låser de to lister sammen).
- **Mest privatlivsvenlige valg:** `autocapture: false` — frem for `mask_all_text`/`mask_all_element_attributes`,
  som stadig sender klik, elementstier og tekstlængder. Vi har brug for sidevisninger, ikke klik, så det mest
  privatlivsvenlige er slet ikke at opsamle. `person_profiles: "identified_only"` og `identify` kaldes aldrig;
  ingen session recording, surveys, heatmaps, dead clicks, exception capture, feature flags eller web-eksperimenter;
  `disable_external_dependency_loading` (SDK'et henter aldrig scripts fra CDN); `save_referrer: false`;
  `respect_dnt: true`; `persistence: "localStorage+cookie"` (kun efter samtykke), `cross_subdomain_cookie: false`.
- **Sidevisninger manuelt** (`capture_pageview: false`): App Router skifter side uden sideindlæsning, så
  `BrowserAnalytics` sender `$pageview` ved første indlæsning og ved hver `usePathname`-ændring.
- **Adresser renses** (`before_send` → `sanitizeEvent`): aldrig forespørgsel eller fragment, rating-tokenet i
  `/vurdering/<token>` (ADR 0060) erstattes af `[token]`, UUID'er af `[id]`. Rensningen dækker også `$referrer`
  og `$set`/`$set_once`.
- **Tilbagekaldelse:** `opt_out_capturing()` + `reset()` + rydning af alle `ph_`/`__ph_`-nøgler i cookies,
  localStorage og sessionStorage. Samme rydning kører når der ikke er samtykke (også uden at SDK'et er hentet),
  så rester fra et udløbet samtykke ikke bliver liggende.
- **Adapter-grænsen:** `posthog-js` importeres kun i `src/lib/analytics/browser.ts` (lint-reglen i ADR 0002).
  Det er ikke en backend-port med stub/demo (ADR 0041): der findes intet at stubbe, og **samtykke må aldrig
  stubbes eller demo-erstattes**. Uden konfiguration findes SDK'et simpelthen ikke.

### 5. CSP (ADR 0070 udvidet i samme PR)

`buildCsp({ posthog: true })` tilføjer `https://eu.i.posthog.com` og `https://eu-assets.i.posthog.com` til
`connect-src` og assets-hosten til `script-src` (en fallback: med `strict-dynamic` ignorerer moderne browsere
værtslisten). Proxyen sætter `posthog` kun når `readBrowserAnalyticsConfig()` er sand — **uden analytics er CSP'en
bit for bit som i ADR 0070** (`connect-src 'self'`), og testen af at de eneste eksterne værter er Google Fonts
står stadig. Målt: den eneste request SDK'et sender med denne konfiguration er `POST eu.i.posthog.com/e/`;
assets-hosten bruges ikke (ingen remote config, ingen CDN-scripts). Den er åbnet fordi ADR 0070 og opgaven
pegede på begge domæner og som sikring mod en SDK-opgradering — **den kan fjernes uden følger** hvis den skal
strammes.

### 6. a11y og dokumentation

Banneret (første besøg, indstillinger åbne, genåbnet fra footeren) og footerlinket er i `a11y.test.tsx`. I
Chromium mod produktionsbygningen giver banneret ingen axe-overtrædelser i hverken desktop- eller mobilbredde
(de to fund der er, er guldkontrasten B-80, uændret). `docs/gdpr/cookies.md` (ny) og leverandør-registeret er
opdateret.

## Verifikation (Chromium mod `next build && next start`, midlertidigt script — ikke committet)

Med `FLAG_ANALYTICS=true` og en dummy-nøgle (PostHog-kald opfanget, ikke sendt):

- 0 CSP-overtrædelser (`securitypolicyviolation`-events) og 0 CSP-fejl i konsollen gennem hele forløbet.
- Første besøg: banneret vises; **0 requests til PostHog**; ingen `ph_`-nøgler i cookies/localStorage.
- «Kun nødvendige»: cookien gemt, banneret væk; efter klient-navigation og reload stadig **0 requests**.
- Footer «Cookie-indstillinger» genåbner banneret med fokus på titlen; ESC lukker indstillinger, ESC igen lukker
  banneret; fokus tilbage på footerlinket.
- «Tillad analyse»: requests til `eu.i.posthog.com/e/`, `ph_`-nøgler oprettet, en ny sidevisning pr. navigation,
  ingen `$autocapture`-events; `/vurdering/SECRETTOKEN123?code=SECRETCODE` giver `/vurdering/[token]` i payload og
  hverken token eller kode.
- Tilbagekaldelse: alle `ph_`-nøgler ryddet, ingen nye requests (heller ikke efter navigation og reload).
- Bemærk til alle der gentager testen: PostHog-SDK'et **dropper begivenheder fra automatiserede browsere**
  (`navigator.webdriver`, «HeadlessChrome») — brug `--disable-blink-features=AutomationControlled` og en normal UA,
  ellers ser det ud som om der ikke sendes noget.

## Konsekvenser

- Positive: samtykket er et reelt opt-in der gælder fra første request; intet at spørge om før analytics er
  tændt; CSP'en åbnes kun når den skal; sletteflowet (ADR 0068) og PostHog-læsningen (ADR 0066) er uændrede.
- Negative / pris: en klient-bundle-chunk (`posthog-js`) hentes først ved samtykke — ingen pris for dem der siger
  nej; layoutet læser en cookie (kun med analytics til; det var allerede dynamisk, ADR 0070). Banneret fylder
  op til 70 % af en mobilskærm med indstillinger åbne (det scroller, og det er ikke en modal).
- **Ikke gjort / åbent:**
  - `TODO(ejer)`: samtykketeksten, kategori-listen og samtykkets levetid (12 mdr.) — og at PostHog-projektet
    (Mads) sættes til at **kassere klient-IP** (projektindstilling «Discard client IP data»); SDK'ets `ip`-flag
    virker ikke længere. Så længe det ikke er sat, ser PostHog IP-adressen på hver request.
  - Der er ingen `consent_event`-tabel: vi kan ikke bevise hvem der sagde ja hvornår (stub-registret). Det er
    bevidst — en tabel kræver RLS, en sletteregel og en retsgrundlagsvurdering, og er ejerens/Mads' valg.
  - Skærmlæser (NVDA/VoiceOver) og zoom 200 % er ikke testet manuelt (B-85's rest).
  - Hvis Supabase-klienten en dag flyttes til browseren, udvides `docs/gdpr/cookies.md` og CSP'ens `connect-src`.
