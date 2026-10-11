# Cookie-oversigt

> Fase 6 (§6.3) / ADR 0072. **Kun det appen faktisk sætter** — ikke det den måske kommer til. Opdatér i
> samme PR som en ny cookie, localStorage-nøgle eller et nyt browser-SDK opstår (og udvid banneret hvis
> det er en ikke-nødvendig kategori). Teksten i banneret er `TODO(ejer): samtykketekst — godkendes sammen med ToS`.

Appen er en førsteparts-oplevelse: der er **ingen reklame-, sporings- eller tredjepartscookies**. De eneste
ikke-nødvendige cookies er PostHogs, og de findes **kun** når analytics er slået til **og** besøgende har sagt ja.

## Kategorier

| Kategori | Kræver samtykke? | Hvad den dækker |
|---|---|---|
| **Nødvendig** | Nej | Login/session, adgangsport og husken af cookie-valget. Uden dem virker platformen ikke |
| **Analyse** | **Ja** (opt-in, aldrig forhåndsafkrydset) | PostHog (EU): sidevisninger. Slås fra som standard |
| Funktionel | — | Findes i samtykkekernen (`src/server/consent`), men **intet bruger den**, og banneret viser den ikke |

## Cookies og browserlager

| Navn | Formål | Levetid | Kategori | Sættes af | Bemærkninger |
|---|---|---|---|---|---|
| `sb-<projekt-ref>-auth-token` (og `…-auth-token.0`, `.1` når den deles) | Supabase Auth: login og session | 400 dage (`Max-Age`, `@supabase/ssr`-default); selve sessionen styres af Supabase-projektets indstillinger | Nødvendig | Server/proxy (`supabase-server.ts`, `proxy.ts`) | Førsteparts, `Path=/`, `SameSite=Lax`, **ikke** httpOnly (SDK'ets default). Sættes først ved login/tilmelding. Navnet afhænger af Supabase-projektets reference |
| `sb-<projekt-ref>-auth-token-code-verifier` | Supabase Auth: PKCE-kode ved bekræftelse af e-mail | Kortvarig | Nødvendig | Server (`@supabase/ssr`) | 🟡 Forventet ved tilmelding med e-mailbekræftelse; **ikke observeret** — kontrollér når Supabase er koblet på |
| `app_gate` | Adgangsporten (ADR 0020): beviser at besøgende kender adgangskoden | 30 dage | Nødvendig | Server-action (`gate/actions.ts`) | Kun når `APP_GATE_ENABLED`. HMAC-signeret, **httpOnly**, `Secure`, `SameSite=Lax`. Indeholder ingen persondata |
| `abaas_consent` | Husker cookie-valget (`{functional, analytics}`) | **12 måneder** (`TODO(ejer)`: teknisk default) | Nødvendig | Klient (`CookieBanner`) | Kun når banneret findes (`FLAG_ANALYTICS` + `NEXT_PUBLIC_POSTHOG_KEY`). `Path=/`, `SameSite=Lax`, `Secure` over https, ikke httpOnly (serveren læser den ved rendering, så banneret ikke blinker). Indeholder ingen persondata |
| `ph_<projektnøgle>_posthog` (cookie) | PostHog: pseudonymt besøgs-id og sessionsdata | 365 dage (PostHog-default, målt) | **Analyse** | Klient (`posthog-js`) | **Kun efter samtykke.** Slettes når samtykket trækkes tilbage. `SameSite=Lax`, ikke på tværs af underdomæner |
| `ph_<projektnøgle>_posthog` (localStorage) | Samme data som cookien (`persistence: localStorage+cookie`) | Til den ryddes | **Analyse** | Klient (`posthog-js`) | Kun efter samtykke; ryddes ved tilbagekaldelse |
| `ph_<projektnøgle>_primary_window_exists`, `_window_id`, `_session_registered_properties`, `_posthog` (sessionStorage) | PostHog: vindue/fane og sessionsegenskaber | Til fanen lukkes | **Analyse** | Klient (`posthog-js`) | Kun efter samtykke; ryddes ved tilbagekaldelse |

Intet andet gemmes: ingen anden `localStorage`/`sessionStorage`, ingen `IndexedDB`, ingen cookies fra Cal.com,
Alunta, Resend eller inMobile (de kaldes server-side, jf. ADR 0070).

## Hvad browser-PostHog sender (efter samtykke)

Én type request: `POST https://eu.i.posthog.com/e/` med `$pageview`-hændelser. Indholdet er sidens **rensede** adresse
(aldrig forespørgsel eller fragment; rating-tokenet i `/vurdering/<token>` erstattes af `[token]`, UUID'er af `[id]`),
browser, styresystem, enhedstype, skærm- og vinduesstørrelse, sprog, tidszone, referrer-domæne samt det pseudonyme
besøgs-id. Der er ingen autocapture (ingen klik, ingen formularfelter, ingen tekst), ingen session recording, ingen
personprofiler og aldrig `identify`. PostHog ser desuden klientens IP-adresse på selve forbindelsen — se
`TODO(mads)` i `leverandoer-register.md` (projektindstilling «Discard client IP data»).

## Tilbagekaldelse og kontrol

- «Cookie-indstillinger» i sidefoden genåbner banneret (kun når banneret findes). Fjernes analyse-afkrydsningen og
  gemmes valget, stopper indsamlingen straks, og alle `ph_`-nøgler i cookies, localStorage og sessionStorage ryddes.
- Uden samtykke hentes PostHog-koden ikke engang, og der sendes intet. Rester efter et udløbet samtykke ryddes ved næste
  sideindlæsning.
- Verifikationen (Chromium mod en produktionsbygning) står i ADR 0072.

## Åbent

- `TODO(ejer)`: samtykketekst og kategori-liste godkendes sammen med ToS; samtykkets levetid (12 mdr.).
- Der er ingen log over hvem der har sagt ja hvornår (`stub-register.md`, «samtykkelog»).
- `sb-…-code-verifier` skal bekræftes når Supabase er koblet på.
