# 0073 — Bekræftelsesrute og adgangskodeflows: invitation, glemt adgangskode og «sæt adgangskode»

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 6 (lukker backlog B-70 og B-71, fundet af e2e-rejsen, ADR 0071)
- **Supplerer:** ADR 0013 (Supabase Auth), ADR 0014 (auth-flow), ADR 0025 (partner-login), ADR 0047 (`translateAuthError`), ADR 0020 (adgangsport), ADR 0070 (CSP)
- **Berører uafklaret punkt:** nej (Spand A — autentificeringsflow og mailskabeloner; ingen forretning, pris, jura eller leverandør)

## Kontekst

e2e-rejsen (ADR 0071) viste at en inviteret partner ikke kunne få en adgangskode, og at ingen
bruger kunne nulstille sin. `invitePartner` (ADR 0025) kalder `inviteUserByEmail`, og
invitationsmailen peger på Supabase Auths egen verify-endpoint, som sender browseren tilbage til
`site_url` med tokens i **URL-fragmentet** (`#access_token=…`). Et fragment når aldrig serveren, og
appen har ingen browser-Supabase-klient (ADR 0014: kun SSR-klienten). Partneren landede derfor på
forsiden uden session — og ejere havde heller ingen «glemt adgangskode». Det blokerede
partner-login i produktion.

To rammer styrer løsningen: **Supabase-domænet står ikke i CSP's `connect-src`** (ADR 0070 — vi
vil helst holde det sådan), og **alt auth-arbejde sker allerede server-side** (server-actions +
`@supabase/ssr`).

## Overvejede muligheder

- **A — Browser-klient læser fragmentet** (`@supabase/supabase-js` i browseren, `onAuthStateChange`
  eller `setSession`). Kræver en klient-side Supabase-klient, Supabase-domænet i `connect-src`, og
  tokens der passerer JavaScript. Bryder to af rammerne.
- **B — `token_hash` + server-side `verifyOtp` (Supabases dokumenterede SSR-flow).** Mailskabelonen
  linker direkte til appen med `token_hash` og `type`; en route handler indløser tokenet på
  serveren og sætter session-cookies via den eksisterende SSR-klient. Intet fragment, ingen
  klient-SDK, ingen ændring af CSP.
- **C — PKCE-kode (`exchangeCodeForSession`)** via `redirectTo`. Kræver at kodeverifikatoren er i
  den browser der anmodede — det holder ikke for en **invitation**, hvor admin anmoder og partneren
  klikker. Duer kun til «glemt adgangskode», så to mekanismer i stedet for én.

## Beslutning

**B.** Én mekanisme til alle e-mailbårne links.

1. **`GET /auth/confirm`** (`src/app/auth/confirm/route.ts`): læser `token_hash` + `type`, kalder
   `verifyOtp({ type, token_hash })` med den eksisterende SSR-klient (`createServerSupabase`), som
   sætter session-cookies, og redirecter. Typerne er en **lukket liste**: `invite`, `recovery`,
   `signup`, `email_change` — alt andet (også `magiclink`/`email`, som appen ikke bruger) afvises
   uden at røre Supabase. Parsing og validering bor i en ren modul, `src/server/auth/confirm.ts`.
   - **`next` er kun en relativ sti** (`safeInternalPath`): afviser absolutte URL'er, `//host`,
     bagstreger (`/\host`), og kontroltegn (en tabulator i `/\t/host` fjernes af URL-parseren og
     giver `//host`). Rutens svar kontrolleres igen mod requestens origin (forsvar i dybden).
     Uden en gyldig `next` bruges en standard pr. type: invitation og nulstilling →
     `/konto/adgangskode`, så en bruger uden adgangskode aldrig lander på et dashboard uden vej tilbage.
   - **Rolige fejl:** et brugt, udløbet eller opfundet token, en ukendt type og et manglende
     token giver alle det samme `/login?fejl=ugyldigt-link`. Koden slås op i en lukket liste
     (`LOGIN_ERRORS`) — den rå `fejl`-parameter gengives aldrig. Svaret bærer `Cache-Control:
     no-store` og `Referrer-Policy: no-referrer`, fordi linket er et engangstoken.
   - **Adgangsporten (ADR 0020) undtages IKKE.** `isGateExempt` er uændret. Ruten er ikke
     nødvendig at åbne: porten er til den lukkede ejer-test og slås fra før launch, og en
     modtager der er bag porten har allerede tastet den delte kode. Hver ny undtagelse åbner en
     auth-fri vej og kræver en ADR; her er der ikke et behov at begrunde den med.
2. **`/konto/adgangskode`** («Vælg adgangskode»): kræver en session (uden en → `/login?fejl=ny-adgangskode`).
   `setPasswordAction` validerer (`validateNewPassword`), tjekker sessionen igen, kalder
   `updateUser({ password })` og redirecter — **partner/lead-partner til `/partner`, alle andre
   til `/dashboard`**. Siden er også en almindelig «skift adgangskode» (link fra `/konto`).
   - **Adgangskoderegel:** samme som signup — mindst **8 tegn** (`PASSWORD_MIN_LENGTH`, nu én
     konstant brugt af både `/signup` og her) og to ens felter. Ingen ny regel er opfundet;
     Supabase-projektets egen politik (længde, læk-tjek B-25) er stadig det endelige værn og
     oversættes af `translateAuthError`, som fik en ny sag: «New password should be different from the old
     password» blev ellers fejlagtigt til «for kort».
3. **`/glemt-adgangskode`**: `requestPasswordResetAction` kalder `resetPasswordForEmail(email)`
   server-side og svarer **altid det samme** («Hvis adressen findes, har vi sendt et link …») —
   også når kontoen ikke findes og når Supabase afviser kaldet (fejlen logges, ikke vises). Intet
   konto-orakel. Linket står på `/login`. Vi sender **ikke** `redirectTo`: skabelonen bærer selv
   stien (`&next=/konto/adgangskode`), så flowet ikke afhænger af dashboardets Redirect URLs-liste.
4. **Mailskabeloner** (`supabase/templates/invite.html`, `recovery.html`) peger på
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery&next=/konto/adgangskode`.
   e2e-stakken bruger dem via `tests/e2e/supabase/config.toml`. CLI'en kan ikke følge et symlink ud
   af projektroden (modsat `migrations/`, som den ikke validerer), så e2e-kopierne er **filkopier**
   — `tests/unit/auth-email-templates.test.ts` holder dem identiske med de kanoniske og linkene
   rigtige. **Bekræftelsesmailen (signup) er bevidst uændret**: ejerens signup-flow (01-ejer) virker, og
   ruten understøtter allerede `type=signup`, så den kan flyttes senere uden kodeændring.
   Produktion kræver at Mads indsætter skabelonerne i dashboardet (`docs/runbook.md`,
   `TODO(mads)`).
5. **B-71 (samme PR):** «Udskift med denne» på `/admin/boards/[id]` redirecter nu til
   `?skiftet=<ind>&fra=<ud>` og siden viser en statuslinje uden for «Udskift X»-sektionen
   (som forsvandt sammen med formularens besked). Statuslinjen vises kun hvis den indkommende
   faktisk sidder på boardet og den udgående ikke gør — en gammel adresse kan ikke få siden til
   at påstå noget der ikke er sket. En Cal.com-advarsel vises som før ud fra revisionssporet.

## Konsekvenser

- **Positive:** partner-login kan sættes i produktion; alle brugere kan nulstille deres adgangskode;
  tokens passerer aldrig JavaScript; CSP uændret; én mekanisme for alle e-mailbårne links; ingen ny
  afhængighed; ruten og actionerne har enhedstests for open-redirect, ukendt type, manglende
  token og ens svar uanset om kontoen findes. e2e gennemspiller invitation → adgangskode → `/partner`
  og glemt adgangskode → login.
- **Negative / pris:** (1) en mailskabelon-ændring i Supabase-dashboardet er en manuel
  produktionsopgave (`TODO(mads)`) — uden den peger invitationen stadig på det gamle endpoint.
  (2) `GET`-linket indløser tokenet ved første kald. Virksomhedsmail med **link-scannere**
  (fx Outlook Safe Links) kan åbne linket før modtageren og brænde engangstokenet; modtageren får så
  `ugyldigt-link` og kan bede om et nyt via «Glemt adgangskode». Hvis det rammer i praksis, er
  afhjælpningen en mellemside med en knap, der POSTer til ruten — uden at ændre skabelonerne.
  (3) Skabelonerne findes i to kopier (kanonisk + e2e), holdt ens af en test.
  (4) GoTrue sender en *bekræftelses*-mail frem for en nulstillingsmail, hvis en inviteret bruger
  der aldrig har accepteret beder om nulstilling; ruten håndterer typen (`signup`) og lander på
  `/dashboard`, så brugeren ikke har en adgangskode endnu — en kant, ikke et hul (invitationen kan
  gensendes, og «Glemt adgangskode» virker efter første accept).
- **Opfølgning:** Mads indsætter skabelonerne og sætter Site URL (`docs/runbook.md`); Supabase-SMTP
  via Resend (ADR 0057) skal være sat op, før nogen mail afleveres i produktion; slå *leaked password
  protection* til (B-25).
