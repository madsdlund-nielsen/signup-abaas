# GDPR — leverandør-register (sub-processorer)

> Fase 0 / Trin 10. Kortlægning af persondata pr. sub-processor: hvilke data, hvilken
> region, EU-residens-status, DPA-status og styrende feature-flag. EU-residens og DPA
> der hænger på en spike eller en ejer-/jura-beslutning er markeret 🔴 (afventer — Claude
> Code beslutter ikke). Opdateres når accounts oprettes og DPA'er underskrives.

Roller: **dataansvarlig** = ABaaS (ejerne). **Databehandlere** = nedenstående leverandører.

| Leverandør | Rolle i appen | Persondata behandlet | Region | EU-residens | DPA | Flag |
|---|---|---|---|---|---|---|
| **Supabase** | DB + auth — sandhedskilde | Navn, e-mail, roller, al forretningsdata | EU — eu-north-1 (Stockholm) | ✅ EU (eu-north-1, ADR 0013) | 🔴 afventer underskrift (Supabase DPA findes) | — |
| **Cal.com** | Booking (multi-host) — **Teams-plan** (ADR 0046) | Navne, e-mails, mødetider. Ejere/kunder er *attendees* (`navn, e-mail, tidszone` — navn og tidszone fra kontoprofilen, ADR 0061), ikke brugere | 🔴 afventer verifikation | 🔴 afventer (punkt 5) — plan-valget svarer **ikke** på residens; `apiUrl` er udskiftelig (`cal.eu`/self-host) | 🔴 afventer underskrift | `booking` |
| **Cal Video** | Multi-party video + optagelse | Billede/lyd af møder | 🔴 afventer verifikation | 🔴 afventer (punkt 6) — følger Cal.com; native optagelse på Teams er uverificeret | dækket af Cal.com-aftalen | `video` |
| **Alunta** | Betaling ind — abonnement/fakturering (ADR 0023) | Navn, e-mail, medlemskabs- og faktureringsmetadata (ikke kortdata — de bor hos gatewayen) | DK (dansk udbyder) | 🟡 dansk udbyder; hosting ikke formelt verificeret | 🔴 afventer underskrift | `payments` |
| **QuickPay** (betalings**gateway**) | Kortregistrering + træk bag Aluntas checkout (ADR 0034) | Kortdata, navn, betalingsmetadata | DK | 🟡 dansk udbyder; hosting ikke formelt verificeret | 🔴 afventer underskrift | `payments` |
| **Nets** (**indløser**/acquirer) | Indløsning af korttransaktioner bag QuickPay (ADR 0034-opdatering) | Kortdata, transaktions- og afregningsdata | DK/EU | 🟡 dansk/nordisk udbyder; hosting ikke formelt verificeret | 🔴 afventer underskrift | `payments` |
| **MobilePay** | Betaling ind (DK) — via **QuickPays** checkout (MobilePay Online) | Navn, telefon, betalingsmetadata | DK/EU | 🟡 går via QuickPay (ADR 0034); ikke en Alunta-gateway (ADR 0032) | 🔴 afventer | `payments` |
| **e-conomic / Dinero** | Bogføring ud | Faktura-/kundedata, CVR | DK/EU | afventer leverandørvalg | 🔴 afventer (leverandør uafklaret) | `accounting` |
| **Ordbogen** (chat.dk / Odin-LLM, nu **odincore.ai**) — endpoint `api.odincore.ai` (alias `api.ordbogen.ai`), `/v1/chat/completions` | AI-mødeopfølgning (ADR 0024, 0058) | Mødeindhold/transskript (kan indeholde PII) | DK — dansk datacenter (oplyst for chat.dk; 🟡 for selve API'et ikke stadfæstet i spec'en — bekræftes skriftligt, `docs/spikes/ordbogen-api.md` #8) | ✅ DK (ADR 0024) | ✅ **håndteret uden for repoet** (Mads, 2026-09-15) — spores ikke herfra | `aiFollowup` |
| **Ordbogen** (ordbogen.ai → **odincore.ai**) — endpoint `api.odincore.ai`, `/v1/audio/transcriptions` | Lyd → tekst (ADR 0024, 0058). Retsgrundlag: **kontrakten** (samtykke til optagelse og AI er en del af kontraktindgåelsen, ADR 0065). Fejler stadig lukket uden et grundlag for mødet (defense-in-depth) | Mødeoptagelse/-tekst | DK — dansk datacenter (som ovenfor: API-region bekræftes) | ✅ DK (ADR 0024) | ✅ **håndteret uden for repoet** (samme aftale som Odin-LLM) | `transcription` |
| **Resend** | Transaktionsmails (notifikationsmotoren, ADR 0057) | E-mailadresser, mailindhold (aflysning/flytning, påmindelse, rating, fejlet betaling) | EU (Dublin, `eu-west-1`) — **vælges på afsenderdomænet i Resend-UI'et, ikke i API-kaldet** | ✅ EU (Dublin) — 🔴 TODO(mads): bekræft at domænet er oprettet i `eu-west-1` | 🔴 afventer underskrift (Resend DPA findes) | `email` |
| **inMobile** | SMS (notifikationsmotoren, ADR 0057) | Telefonnumre (E.164) og beskedindhold — **kun for brugere der har angivet et nummer** (`app_user.phone_e164`, `/konto`, ADR 0061). Retsgrundlag: **kontrakten** — SMS-samtykket er en del af kontraktindgåelsen, og der er ingen opt-in/out (ADR 0065). Kontraktens ordlyd er ejerens (TODO(ejer)) | DK | ✅ DK | 🔴 afventer underskrift | `sms` |
| **PostHog** | Analytics + fejlovervågning; læses desuden aggregeret til admin-driftsstatus (ADR 0066); **browser-SDK efter samtykke** (ADR 0072) | Pseudonyme events, evt. IP/enhed. Læsningen sender kun en forespørgsel ud (tidsvinduer) og modtager tællinger + fejltypenavne — ingen persondata forlader os, og intet gemmes. **Browser-SDK'et** (`posthog-js`, kun efter `analytics`-samtykke) sender `$pageview` til `eu.i.posthog.com/e/`: renset adresse (ingen forespørgsel/fragment, rating-token og UUID'er skjult), browser/OS/enhedstype, skærm- og vinduesstørrelse, sprog, tidszone, referrer-domæne og et pseudonymt besøgs-id (cookie + localStorage `ph_<nøgle>_posthog`, 365 dage). Ingen autocapture, ingen session recording, ingen personprofiler, aldrig `identify`. **Klient-IP ses af PostHog på forbindelsen** — 🔴 TODO(mads): slå «Discard client IP data» til i PostHog-projektet. Se `docs/gdpr/cookies.md` | EU (eu.posthog.com; ingest `eu.i.posthog.com`) | ✅ EU | 🔴 afventer underskrift (PostHog DPA findes) | `analytics` + `NEXT_PUBLIC_POSTHOG_KEY` |
| **Netlify** (hosting) | SSR, logs, cron | Request-/session-metadata, logs | EU — Frankfurt (`fra`) | 🟡 kræver UI-region-valg + Pro-plan (ADR 0012) | 🔴 afventer underskrift (Netlify DPA findes) | — |
| **GitHub Actions** | CI/CD | Kildekode (ingen prod-PII), CI-metadata | Global | n/a (ingen prod-persondata) | dækket af GitHub-vilkår | — |

## Noter

- **EU-residens fra fase 0:** EU-hostede leverandører (Supabase eu-north-1, Resend, inMobile,
  PostHog) er bekræftet. Netlify (hosting) er valgt (ADR 0012) med EU-region (Frankfurt) — men
  regionen skal aktivt sættes i Netlify-UI'et og **kræver Pro-planen** (🟡). Efter ADR 0046 er
  de resterende 🔴 reduceret til: **Cal.com/Cal Video** (residens + optagelse skal verificeres
  på Teams) og **regnskab** (leverandørvalg hos ejer). Transskription og LLM er ikke længere
  blandt dem.
- **DPA-struktur:** alle databehandlere skal have en underskrevet DPA før produktion.
  Underskrifterne er en ejer-/Mads-opgave; registret her er kilden til "hvilke mangler".
  🔴 TODO(ejer): indhent + underskriv DPA pr. leverandør; arkivér reference her.
  **Ordbogen er undtaget sporingen her** — aftalen er håndteret uden for repoet
  (Mads, 2026-09-15) og skal ikke stå som åben blokering.
- **Samtykke vs. nødvendig:** transaktionsmails/SMS (Resend, inMobile) og betaling er
  nødvendig databehandling for ydelsen. **Siden 2026-10-11 (ADR 0065) er samtykke til
  mødeoptagelse, AI-behandling (Ordbogen) og SMS en del af kontrakten** (ToS + honoraraftale) —
  retsgrundlaget er kontrakten, og der er ingen opt-in/out på platformen. **Undtagelse:** analytics
  (PostHog) kræver fortsat samtykke (`analytics`-kategorien i `src/server/consent`) — besøgende
  før kontrakt er ikke dækket, og cookiereglerne kræver samtykke uanset kontrakt. Afgørelsen er
  Mads'. **Retsgrundlaget for browser-PostHog er samtykke** (art. 6(1)(a)); cookie-banneret (ADR 0072)
  indhenter det, intet sendes før «Tillad analyse», og tilbagekaldelse stopper indsamlingen og rydder
  alle `ph_`-nøgler. Teksten og samtykkets levetid (12 mdr.) er ejerens (TODO(ejer)).
- **Dataminimering:** adaptere sender kun de felter en operation kræver (se porte i `src/lib`).
  Telefonnummeret forlader kun Supabase til en SMS-udsendelse: motoren slår det kun op dér og
  sender kun hvis brugeren har angivet et nummer (ADR 0061, 0065). Kontoens navn flettes kun ind
  i en besked til personen selv (`{{modtager_navn}}`).
- **Udsendelseslog (ADR 0057):** `notification_delivery` indeholder en bruger-reference
  (`recipient_user_id`), aldrig en e-mailadresse eller et telefonnummer — adressen slås op i det
  øjeblik der sendes og gemmes ikke. Fejltekster skrubbes for adresser før de logges eller sendes
  til PostHog. Skabeloner (`notification_template`) indeholder ingen persondata; flettede værdier
  (boardnavn, mødetidspunkt) findes kun i den udgående besked.
- **Sletning hos databehandlerne (ADR 0068):** `docs/gdpr/sletteflow.md` beskriver hvad der slettes hvor. Automatisk
  sletning findes kun hvor API'et er dokumenteret — PostHog (persons delete) og Resend (contacts delete) — samt
  Cal.com-hosts/-aflysning via booking-porten. Cal.com-sæde og -attendee-data, inMobile og Ordbogen slettes manuelt
  (🔴 TODO(mads): slette-API). Alunta, QuickPay, Nets og regnskabssystemet slettes aldrig af flowet:
  opbevaringspligt er ikke afklaret (🔴 TODO(ejer/jura)).
