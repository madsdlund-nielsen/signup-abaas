# Accounts der skal oprettes

> Praktisk tjekliste over de eksterne konti ABaaS har brug for. **Autoritative kilder:**
> `.env.example` (variabelnavne) og `docs/gdpr/leverandoer-register.md` (region/EU/DPA).
> Denne fil samler dem ét sted og markerer hvad der er besluttet vs. afventer et valg.
>
> Repoet er bevidst **kontofrit**: hver adapter kører som stub, alle `FLAG_*` er OFF, og
> ingen rigtige nøgler ligger i repoet. Ejerne opretter konti og giver Mads adgang.

## Sådan bruges nøglerne

1. `cp .env.example .env.local` (gitignored) — udfyld nøglen ud for dens variabel.
2. Sæt det tilhørende `FLAG_*=true` (integrationen aktiveres først når **både** nøgle og flag findes).
3. Adapteren i `src/lib/<vendor>/index.ts` (eller `src/server/auth`) læser env via `readConfig`
   og skifter fra stub til rigtig klient. Ingen kodeændring nødvendig.
4. **Produktion:** runtime-secrets sættes i **Netlify > Environment variables** (ADR 0012),
   ikke i `.env.local` og ikke som GitHub-secrets. `.env.local` er kun til lokal udvikling.

## A. Opret nu — leverandør fastlagt

| Konto | Env-variabler | Flag | Status / note |
|---|---|---|---|
| **Supabase** (DB + auth) | `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | — | ✅ Besluttet: region **eu-north-1** (ADR 0013). Underskriv Supabase-DPA. Service-role = server-only. |
| **Netlify** (hosting) | (sættes i Netlify env vars) | — | ✅ Besluttet (ADR 0012). 🔴 Sæt Functions region = EU (Ireland) i UI'et (kræver ≥ Pro). Underskriv Netlify-DPA. |
| **Resend** (e-mail, EU/Dublin) | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | `FLAG_EMAIL` | EU ✅. Underskriv DPA. |
| **inMobile** (SMS, DK) | `INMOBILE_API_KEY`, `INMOBILE_SENDER` | `FLAG_SMS` | EU/DK ✅. Underskriv DPA. |
| **PostHog** (analytics, EU) | `POSTHOG_KEY` (`POSTHOG_HOST` er forudfyldt) | `FLAG_ANALYTICS` | Dedikeret ABaaS-projekt på eu.posthog.com. Underskriv DPA. |
| **GitHub** | — | — | Repo findes; slå branch protection til på `main`. |
| **Domæne** signupacademy.com + DNS | — | — | Ejer-opgave; giv Mads DNS-adgang. |

## B. Vælg leverandør / afslut spike først — opret derefter

| Konto | Env-variabler | Flag | Blokeret af |
|---|---|---|---|
| **Anthropic Claude API** (el. EU-LLM) | `LLM_API_KEY` | `FLAG_AIFOLLOWUP` | EU-residens/DPA (Mads) |
| **Cal.com** (booking) | `CALCOM_API_KEY` | `FLAG_BOOKING` | multi-host-spike + plan |
| **Cal Video** | `CALVIDEO_API_KEY` | `FLAG_VIDEO` | plan / EU-residens |
| **Stripe + MobilePay** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MOBILEPAY_MERCHANT_ID` | `FLAG_PAYMENTS` | dataflow (Mads) + priser (ejer); Alunta-alternativ åbent |
| **e-conomic ELLER Dinero** | `ACCOUNTING_API_KEY` | `FLAG_ACCOUNTING` | leverandørvalg (ejer) |
| **Transskription** (DK/EU) | `TRANSCRIPTION_API_KEY` | `FLAG_TRANSCRIPTION` | udbydervalg |

## Tværgående

- **DPA før produktion:** hver databehandler skal have en underskrevet DPA (ejer/jura).
  Registret i `docs/gdpr/leverandoer-register.md` er kilden til "hvilke mangler".
- **In-app messaging udelades bevidst** — modulet er uafklaret og har intet flag (CLAUDE.md).
