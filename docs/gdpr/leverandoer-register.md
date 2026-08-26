# GDPR — leverandør-register (sub-processorer)

> Fase 0 / Trin 10. Kortlægning af persondata pr. sub-processor: hvilke data, hvilken
> region, EU-residens-status, DPA-status og styrende feature-flag. EU-residens og DPA
> der hænger på en spike eller en ejer-/jura-beslutning er markeret 🔴 (afventer — Claude
> Code beslutter ikke). Opdateres når accounts oprettes og DPA'er underskrives.

Roller: **dataansvarlig** = ABaaS (ejerne). **Databehandlere** = nedenstående leverandører.

| Leverandør | Rolle i appen | Persondata behandlet | Region | EU-residens | DPA | Flag |
|---|---|---|---|---|---|---|
| **Supabase** | DB + auth — sandhedskilde | Navn, e-mail, roller, al forretningsdata | EU — eu-north-1 (Stockholm) | ✅ EU (eu-north-1, ADR 0013) | 🔴 afventer underskrift (Supabase DPA findes) | — |
| **Cal.com** | Booking (multi-host) | Navne, e-mails, mødetider | 🔴 afventer multi-host-spike | 🔴 afventer (punkt 5) | 🔴 afventer | `booking` |
| **Cal Video** | Multi-party video + optagelse | Billede/lyd af møder | 🔴 afventer plan/spike | 🔴 afventer (punkt 6) | 🔴 afventer | `video` |
| **Alunta** | Betaling ind — abonnement/fakturering (ADR 0023) | Navn, e-mail, medlemskabs- og faktureringsmetadata (ikke kortdata — de bor hos gatewayen) | DK (dansk udbyder) | 🟡 dansk udbyder; hosting ikke formelt verificeret | 🔴 afventer underskrift | `payments` |
| **QuickPay** (kort-gateway) | Kortregistrering + træk bag Aluntas checkout (ADR 0034) | Kortdata, navn, betalingsmetadata | DK | 🟡 dansk udbyder; hosting ikke formelt verificeret | 🔴 afventer underskrift | `payments` |
| **MobilePay** | Betaling ind (DK) — via **QuickPays** checkout (MobilePay Online) | Navn, telefon, betalingsmetadata | DK/EU | 🟡 går via QuickPay (ADR 0034); ikke en Alunta-gateway (ADR 0032) | 🔴 afventer | `payments` |
| **e-conomic / Dinero** | Bogføring ud | Faktura-/kundedata, CVR | DK/EU | afventer leverandørvalg | 🔴 afventer (leverandør uafklaret) | `accounting` |
| **Ordbogen** (chat.dk / Odin-LLM) | AI-mødeopfølgning (ADR 0024) | Mødeindhold/transskript (kan indeholde PII) | DK — dansk datacenter | ✅ DK (ADR 0024) | 🔴 afventer underskrift (blokerer produktionsbrug) | `aiFollowup` |
| **Ordbogen** (ordbogen.ai) | Lyd → tekst (ADR 0024) | Mødeoptagelse/-tekst | DK — dansk datacenter | ✅ DK (ADR 0024) | 🔴 afventer underskrift (samme aftale som Odin-LLM) | `transcription` |
| **Resend** | Transaktionsmails | E-mailadresser, mailindhold | EU (Dublin) | ✅ EU (Dublin) | 🔴 afventer underskrift (Resend DPA findes) | `email` |
| **inMobile** | SMS | Telefonnumre, beskedindhold | DK | ✅ DK | 🔴 afventer underskrift | `sms` |
| **PostHog** | Analytics + fejlovervågning | Pseudonyme events, evt. IP/enhed | EU (eu.posthog.com) | ✅ EU | 🔴 afventer underskrift (PostHog DPA findes) | `analytics` |
| **Netlify** (hosting) | SSR, logs, cron | Request-/session-metadata, logs | EU — Ireland (`dub`) | 🟡 kræver UI-region-valg + Pro-plan (ADR 0012) | 🔴 afventer underskrift (Netlify DPA findes) | — |
| **GitHub Actions** | CI/CD | Kildekode (ingen prod-PII), CI-metadata | Global | n/a (ingen prod-persondata) | dækket af GitHub-vilkår | — |

## Noter

- **EU-residens fra fase 0:** EU-hostede leverandører (Supabase eu-north-1, Resend, inMobile,
  PostHog) er bekræftet. Netlify (hosting) er valgt (ADR 0012) med EU-region (Ireland) — men
  regionen skal aktivt sættes i Netlify-UI'et (🟡). De resterende 🔴-markerede afhænger af et
  leverandørvalg (regnskab, transskription, LLM), Cal.com-spiken eller account-oprettelse —
  alle uden for Claude Codes beslutningsret.
- **DPA-struktur:** alle databehandlere skal have en underskrevet DPA før produktion.
  Underskrifterne er en ejer-opgave; registret her er kilden til "hvilke mangler".
  🔴 TODO(ejer): indhent + underskriv DPA pr. leverandør; arkivér reference her.
- **Samtykke vs. nødvendig:** transaktionsmails/SMS (Resend, inMobile) og betaling er
  nødvendig databehandling for ydelsen; analytics (PostHog) kræver samtykke
  (`analytics`-kategorien i `src/server/consent`).
- **Dataminimering:** adaptere sender kun de felter en operation kræver (se porte i `src/lib`).
