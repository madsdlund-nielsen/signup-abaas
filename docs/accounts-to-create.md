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

> **Tier-kolonnen er et estimat, ikke en aftale.** Priser er ekskl. moms og hentet fra
> leverandørernes egne prissider 2026-09-15. Verificér ved oprettelse.

| Konto | Tier-estimat | Env-variabler | Flag | Status / note |
|---|---|---|---|---|
| **Supabase** (DB + auth) | **Pro, $25/md** | `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | — | ✅ Region **eu-north-1** (ADR 0013). Free-tieren **pauser efter 1 uges inaktivitet** og har ingen backup — derfor Pro. Service-role = server-only |
| **Netlify** (hosting) | **Pro, $20/md** | (sættes i Netlify env vars) | — | ✅ Besluttet (ADR 0012). 🔴 **Pro er en GDPR-gate, ikke en luksus:** funktions-region kan kun vælges på Pro/Enterprise — uden den kører vi i US East (Ohio). Teamet er p.t. på free |
| **Cal.com** (booking) | **Teams, $12/bruger/md** | `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_WEBHOOK_SECRET`, (`CALCOM_API_URL`) | `FLAG_BOOKING` | ✅ Besluttet (ADR 0046). Teams bærer **Collective events** + **webhooks**; Organizations tilføjer kun sub-teams + SAML, som vi ikke bruger. **Sæder = rådgivere + admin** — ejere/kunder er attendees og koster ingen sæder. 25% rabat ved årlig betaling. ⚠ `CALCOM_EVENT_TYPE_ID` bliver **pr. board** (B-23) |
| **Cal Video** | (indeholdt i Cal.com) | `CALVIDEO_API_KEY` | `FLAG_VIDEO` | **Ikke en separat leverandør** — følger med Cal.com. 🔴 Native optagelse på Teams er uverificeret (spike L-8) |
| **Ordbogen** (LLM + transskription) | kontakt salg | `LLM_API_KEY`, `TRANSCRIPTION_API_KEY` | `FLAG_AIFOLLOWUP`, `FLAG_TRANSCRIPTION` | ✅ Besluttet (ADR 0024). **Konto bestilt** (Mads, 2026-09-15). Én konto dækker begge. DPA er **håndteret uden for repoet**. Bemærk: `ordbogen.ai` → **`odincore.ai`** |
| **Alunta** (betaling ind) | **Starter 199 kr/md** (25 kunder) → **Growth 499 kr/md** (100) | `ALUNTA_API_KEY`, `ALUNTA_PLAN_ID`, `ALUNTA_WEBHOOK_SECRET`, (`ALUNTA_API_URL`) | `FLAG_PAYMENTS` | ✅ ADR 0023/0032/0034. Free-tieren (10 kunder / 10.000 kr MRR) rækker kun til test_mode. ⚠ Planen oprettes som **abonnement med 4-ugers interval** — ikke usage-plan (ADR 0034). Priser indtastes af admin, aldrig af kode |
| **QuickPay** (gateway **+ indløser**) | **148 kr/md** i alt | (konfigureres i Alunta-UI'et) | `FLAG_PAYMENTS` | ✅ Valgt (ADR 0034). **QuickPay udfylder også indløser-rollen** — ingen separat acquirer-aftale. 99 kr/md + **MobilePay Online-tillæg 49 kr/md** = 148 kr/md, + 0,25 kr/transaktion + variable kortgebyrer. ⚠ Liveverifikation udestår |
| **Resend** (e-mail, EU/Dublin) | **Free** (3.000 mails/md) | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | `FLAG_EMAIL` | EU ✅. Volumenestimat ligger langt under free-loftet; opgradér til Pro ($20) først hvis loftet eller en EU-region kræver det. Bruges også til Supabase-SMTP |
| **inMobile** (SMS, DK) | **289 kr/md** + 0,289 kr/SMS | `INMOBILE_API_KEY`, `INMOBILE_SENDER` | `FLAG_SMS` | EU/DK ✅. Spørg om API-/gateway-adgang alene er billigere end fuld platformadgang |
| **PostHog** (analytics, EU) | **Free** | `POSTHOG_KEY` (`POSTHOG_HOST` forudfyldt) | `FLAG_ANALYTICS` | Free-tieren (1M events/md) er rigeligt. Dedikeret ABaaS-projekt på eu.posthog.com |
| **GitHub** | **Free** → verificér | — | — | Repo findes. ⚠ Branch protection på private repos kan kræve Team (~$4/bruger/md) — se `docs/backlog.md` B-11 |
| **Domæne** signupacademy.com + DNS | — | — | — | Ejer-opgave; giv Mads DNS-adgang |

## B. Vælg leverandør først — opret derefter

| Konto | Tier-estimat | Env-variabler | Flag | Blokeret af |
|---|---|---|---|---|
| **e-conomic ELLER Dinero** | ~150-400 kr/md | `ACCOUNTING_API_KEY` | `FLAG_ACCOUNTING` | **Leverandørvalg (ejer)** — det eneste tilbageværende leverandørvalg. Bemærk at e-conomics API typisk kræver en app-/integrationsaftale oveni |

## Groft run-rate

Faste poster: Supabase $25 + Netlify $20 + Alunta 199-499 kr + QuickPay 148 kr +
inMobile 289 kr + regnskab ~150-400 kr. Cal.com er **$12 × antal rådgivere** og skalerer
med kataloget, ikke med omsætningen:

| Rådgivere i kataloget | Cal.com/md | Samlet run-rate (ca.) |
|---|---|---|
| 10 | ~800 kr | ~2.000 kr/md |
| 25 | ~1.900 kr | ~3.100 kr/md |
| 40 | ~3.100 kr | ~4.300 kr/md |

Ordbogen er ikke med — pris kendes først ved kontakt. Kortgebyrer (indløser-delen hos
QuickPay) er variable og kommer oveni.

## Tværgående

- **DPA før produktion:** hver databehandler skal have en underskrevet DPA (ejer/jura).
  Registret i `docs/gdpr/leverandoer-register.md` er kilden til "hvilke mangler".
- **In-app messaging udelades bevidst** — modulet er uafklaret og har intet flag (CLAUDE.md).
