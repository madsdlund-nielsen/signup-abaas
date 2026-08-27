# Opsætning til ejer-test — runbook

> Rækkefølgen til at få appen til at køre end-to-end mod et rigtigt Supabase-projekt.
> Skrevet til afleveringen **mandag 2026-08-31** (testbar MVP, ikke færdigt produkt).
>
> **Kernepointe:** blokeringen er ikke kode — det er konti. Uden Supabase konfigureret
> falder auth tilbage til en stub, og signup, quiz, board-matching og partner-login gør
> ingenting. Alt andet i listen kan vente; trin 1–4 kan ikke.

## 0. Forudsætninger

```bash
npm ci                 # wirer også husky-gaten (prepare → husky)
cp .env.example .env.local
```

## 1. Supabase — låser alt andet op

1. Opret projektet i region **eu-north-1 (Stockholm)** (ADR 0013). Underskriv Supabase-DPA.
2. Hent de fire værdier til `.env.local`:
   - `DATABASE_URL` (connection string, Session/Direct)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, aldrig `NEXT_PUBLIC_`

⚠ Service-role-nøglen skal være den **hemmelige** (`sb_secret_…`), ikke den publishable.
Er den forkert, fejler `provisionOwner` med netop den besked — den tjekker efter, frem for
at efterlade en bruger uden rolle.

## 2. Skema

```bash
npm run db:link        # npx supabase link
npm run db:push        # anvender supabase/migrations/ (0001 → 0014)
```

Verificér bagefter at `schema_migrations` indeholder alle 14.

## 3. Demodata — så ejerne ikke møder tomme skærme

```bash
npm run db:seed:demo
```

Giver en **publiceret quiz** (ét kompetence-spørgsmål med otte tag-svar + fritekst, ét
frekvens-spørgsmål med 4/8/12 uger) og **seks demopartnere** med kompetence-tags, valgt så
hvert tag er dækket og board-matchingen har noget reelt at arbejde med.

Alle demorækker har uuid'er i `d0000000-0000-4000-8000-…`-serien. Fjern dem igen med:

```bash
npm run db:seed:demo:clean
```

⚠ Der seedes **bevidst ingen prisregler**. Beløb er ejer-territorium (`docs/stub-politik.md`
forbyder et plausibelt forretningstal i koden, også som demodata). Indtil Andreas og Mette
har fastlagt satserne, kan `/betaling` ikke beregne en pris — det er et synligt hul, ikke en fejl.

## 4. Den første admin-bruger

Roller kan **ikke** self-service tildeles — det er med vilje (ingen rettighedseskalering fra
åben signup). Derfor:

1. Opret brugeren via `/signup` i appen. Den får rollen `ejer` automatisk.
2. Giv den `admin` i Supabase SQL Editor:

```sql
insert into user_role_assignment (user_id, role)
select id, 'admin' from app_user where email = 'DIN@EMAIL.dk'
on conflict do nothing;
```

3. Log ud og ind igen, og gå til `/admin`.

Gentag trin 1 uden trin 2 for at teste ejer-flowet som en almindelig kunde.

## 5. Netlify

- Sæt alle runtime-secrets i **Netlify → Environment variables** (ADR 0008), ikke i repoet.
- 🔴 **Functions region = EU (Frankfurt, `fra`)** — SKAL sættes i UI'et før rigtige persondata.
  Pr.-funktion-region i `netlify.toml` gælder ikke for Next.js-funktioner. Kræver ≥ Pro.

## 6. Valgfrit til mandag

| Integration | Nøgler | Uden dem |
|---|---|---|
| **Cal.com** (booking) | `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_WEBHOOK_SECRET` + `FLAG_BOOKING=true` | Booking-UI'et viser den ærlige "ikke konfigureret"-besked. Kør `docs/spikes/multi-host.md`-checklisten når nøglerne lander |
| **Resend** (mail) | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` + `FLAG_EMAIL=true` | Supabase sender bekræftelsesmails med sin egen SMTP (rate-limited) |
| **PostHog** | `POSTHOG_KEY` + `FLAG_ANALYTICS=true` | Fejl logges kun til konsollen |
| **Alunta + QuickPay** | se `docs/accounts-to-create.md` | Betaling er slået fra. ⚠ Opret planen som **abonnement med 4-ugers interval**, ikke usage-plan (ADR 0034) |

## 7. Hvad ejerne kan teste mandag

Med trin 1–4 på plads virker: signup og login · den samtalende onboarding-quiz ·
board-matching og board-anbefaling med partnerprofiler · admin-fladen (quiz, tags,
partnerkatalog, invitationer) · partner-login og self-service-profil.

Kræver nøgler: booking og video (Cal.com) · betaling (Alunta/QuickPay) · mails og SMS.

**Ikke bygget endnu:** forberedelse, rating, AI-mødeopfølgning, transskription og
notifikationer (fase 4), honorar og dashboards (fase 5).

## Adgangsporten

`APP_GATE_*` (ADR 0020) er implementeret men **bruges ikke** (Mads, 2026-08-26). Appen er
dermed åben for enhver der kender URL'en. Det er en bevidst beslutning: signup giver kun
rollen `ejer`, RLS isolerer data pr. bruger, og admin skal tildeles manuelt — så
eksponeringen er spam, ikke datalækage. Skal den alligevel bruges, kræver den tre env-vars
og en hash fra `scripts/hash-gate-password.mjs`.
