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
| **Stripe** | Betaling ind | Navn, e-mail, betalingsmetadata (ikke fulde kortdata — tokeniseret) | Global (EU-databehandling muligt) | 🔴 afventer dataflow (Mads) | 🔴 afventer (Stripe DPA findes) | `payments` |
| **MobilePay** | Betaling ind (DK) | Navn, telefon, betalingsmetadata | DK/EU | afventer konto | 🔴 afventer | `payments` |
| **e-conomic / Dinero** | Bogføring ud | Faktura-/kundedata, CVR | DK/EU | afventer leverandørvalg | 🔴 afventer (leverandør uafklaret) | `accounting` |
| **Anthropic Claude / EU-LLM** | AI-mødeopfølgning | Mødeindhold/transskript (kan indeholde PII) | 🔴 afventer (Claude vs. EU-hostet) | 🔴 afventer EU-residens/DPA (Mads) | 🔴 afventer | `aiFollowup` |
| **Transskription** | Lyd → tekst | Mødeoptagelse/-tekst | 🔴 afventer udbydervalg | 🔴 afventer (dansk/EU søges) | 🔴 afventer | `transcription` |
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
