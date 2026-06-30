# Fase 0 — rapport: åbne beslutninger + integration-handoff

> Status: **første udkast** (kontofri del af fase 0). Denne rapport samler alle
> 🔴 FLAG-punkter og 🟡 SPIKES ét sted (jf. DoD i `docs/fase-0-eksekvering.md`), så
> de åbne beslutninger ligger samlet — ikke spredt i kodekommentarer. Opdateres
> løbende efterhånden som punkter afklares.

Dato: 2026-06-30. Forfatter: Claude Code. Modtagere: Mads + ejerne (Andreas/Mette).

---

## 1. Hvad dette udkast leverer (🟢 BYG — kontofrit)

Alt nedenstående kører/bygger/testes **uden** accounts eller API-nøgler:

- Next.js (App Router) + TypeScript streng + design-token-fundament (kanon-CTA: guld,
  firkantet, versal; tynd navy-overskrift i Open Sans — kun via tokens).
- Feature-baseret mappestruktur + håndhævet lag-grænse (`features` → kun porte i `lib`).
- **Adapter-/port-lag for alle 9 sub-processorer** (stubs bag feature-flags) — klar til
  at blive "fyldt ind" når nøgler lander. Se §4.
- Env-baseret feature-flag-system (alle integrationer OFF; in-app messaging mørklagt).
- Provider-agnostisk auth-abstraktion (`src/server/auth`) — afventer auth-spiken.
- Supabase-schema (rolle-enum + bruger↔rolle + board) med RLS aktiv og **negative
  policy-tests** mod lokal Postgres (kontofrit).
- CI (lint · type · build · unit · integration · db) tilpasset fra qlim8 — **uden** CD.
- ADR 0002–0009 for hvert ikke-trivielt valg.

Verifikation lokalt: `npm run lint`, `npm run check`, `npm run build`, `npm run test:unit`,
`npm run test:integration`, og `npm run test:db` (med `docker compose -f docker-compose.test.yml up -d`).

---

## 2. 🟡 SPIKES — afventer account-adgang (Claude Code må IKKE beslutte)

| Spike | Punkt | Hvad mangler | Bliver til |
|---|---|---|---|
| **Hosting** (Henosia DK vs. Netlify IE) | 24 + 26 | Deploy hello-world til begge; test SSR + cron; verificér EU-residens | ADR + valg → deploy-job + secret-store |
| **Auth** (Supabase Auth vs. eget) | 25 | Vurdér RLS-samspil, EU-residens, senere Stripe/MobilePay-flow; minimal login-prøve | ADR + integration bag `src/server/auth` |
| **Cal.com multi-host** | 5 + 6 | Verificér 2-3 værter + ejer (Platform managed users + Atoms); EU-residens; native optagelse på valgt plan | ADR + rigtig `BookingProvider`/`VideoProvider` |

Alle tre spikes kræver enten live-accounts eller ejer/Mads-beslutning og er derfor udskudt.

> **GDPR-arkitektur (Trin 10): LEVERET** (ADR 0011). Leverandør-register, sletteflow-skitse
> og opt-in samtykke-model er på plads (`docs/gdpr/`, `src/server/consent`). Tilbage er
> ejer-/jura-afhængigt: DPA-underskrifter pr. leverandør, samtykketekst/ToS og opbevarings-
> perioder (bogføring/betaling) — se §3.

---

## 3. 🔴 FLAG — uafklarede punkter rørt i koden

Markeret i kode med `// TODO(ejer):` / `// TODO(mads):`.

**Afventer ejer (forretning):**
- Honorarsats + meeting-fee (binder `amountMinor` i `PaymentProvider`).
- Regnskabssystem: **e-conomic vs. Dinero** (`AccountingExporter` er leverandør-neutral).
- Lead-partner: tildelings-/rotationsregler (`board_partner.is_lead` er kun et flag nu).
- Board-livscyklus (board-entiteten holdes livscyklus-agnostisk).
- In-app messaging: **hele modulet** — `inAppMessaging`-flag hårdkodet OFF.
- Samtykke til mødeoptagelse, note-synlighed, ToS + honoraraftale (rører ikke koden endnu).

**Afventer Mads (teknisk):**
- LLM EU-dataresidens/DPA (`LlmProvider` — Claude API vs. EU-hostet).
- Transskription: dansk/EU-udbyder (`TranscriptionProvider`).
- Alunta vs. Stripe Billing; Stripe/Supabase-dataflow (`PaymentProvider`).
- Host-specifik secret-store (afhænger af hosting-spiken).

---

## 4. Integration-handoff — hvad jeg skal bruge næste uge

Når du har oprettet accounts og giver adgang: udfyld de relevante env-variabler (se
`.env.example`), sæt det tilhørende `FLAG_*=true`, og udfyld den rigtige adapter bag
den uændrede port. Pr. sub-processor:

| Sub-processor | Port | Env-variabler | Flag | Blokeret af |
|---|---|---|---|---|
| Supabase (DB/auth) | — / `src/server/auth` | `DATABASE_URL` | — | Projekt (EU) + auth-spike |
| Cal.com (booking) | `BookingProvider` | `CALCOM_API_KEY` | `FLAG_BOOKING` | multi-host-spike + plan |
| Cal Video | `VideoProvider` | `CALVIDEO_API_KEY` | `FLAG_VIDEO` | plan/EU-residens |
| Stripe + MobilePay | `PaymentProvider` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MOBILEPAY_MERCHANT_ID` | `FLAG_PAYMENTS` | dataflow + priser (ejer) |
| e-conomic / Dinero | `AccountingExporter` | `ACCOUNTING_API_KEY` | `FLAG_ACCOUNTING` | leverandørvalg (ejer) |
| Claude / EU-LLM | `LlmProvider` | `LLM_API_KEY` | `FLAG_AIFOLLOWUP` | EU-residens/DPA |
| Transskription | `TranscriptionProvider` | `TRANSCRIPTION_API_KEY` | `FLAG_TRANSCRIPTION` | udbydervalg |
| Resend (e-mail) | `EmailSender` | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | `FLAG_EMAIL` | konto |
| inMobile (SMS) | `SmsSender` | `INMOBILE_API_KEY`, `INMOBILE_SENDER` | `FLAG_SMS` | konto |
| PostHog (EU) | `Analytics` | `POSTHOG_KEY`, `POSTHOG_HOST` | `FLAG_ANALYTICS` | live-projektnøgle (Trin 8) |

---

## 5. Bevidst udeladt (governance vinder)

- **CD/deploy:** intet deploy-job — hosting er en åben spike (ADR 0009). Tilføjes efter valg.
- **Branch protection på `main`:** kan ikke committes — slå til i GitHub-settings (kræv
  grøn CI + PR). Indtil da gælder kravet kun konventionelt.
- **Live Supabase-projekt / live PostHog-nøgle:** afventer adgang; kører på stub/lokal
  Postgres indtil da.

## 6. Næste skridt når adgang lander

1. Hosting-spike → ADR + deploy-job + secret-store.
2. Auth-spike → ADR + integration bag `src/server/auth`.
3. Supabase-projekt (EU) + staging/prod-review-flow.
4. Cal.com multi-host-spike → ADR + rigtige booking/video-adaptere.
5. PostHog EU live + verificér events/exception-capture (Trin 8).
6. GDPR-arkitektur (leverandør→region→status, sletteflow, samtykke-hook) → ADR.
