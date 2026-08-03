# Fase 1 — Onboarding & board

> Mål: en ejer kan gennemføre onboarding-quizzen, få anbefalet et board på 2-3
> partnere med profiler, og admin kan styre quiz + partner-katalog + tags.
> Forudsætter at fase 0 er grøn. Læs `CLAUDE.md` først.

## Leverancekriterier (Definition of Done for fase 1)

- [ ] Auth-flow fungerer (login/signup) oven på fase 0's auth-valg.
- [ ] Quiz: admin-UI til at oprette/redigere spørgsmål, **med preview inden gem.**
- [ ] Quiz: drag-n-drop af kompetence-tags.
- [ ] Quiz: conversational flow på ejer-siden.
- [ ] Partner-katalog: admin kan oprette partnere + tildele kompetence-tags
      (**partner kan IKKE selv redigere egne tags**).
- [ ] Board-matching: pulje-filtrering → match til 2-3 partnere.
- [ ] Board-anbefaling vist med partner-profiler.
- [ ] "Udskift"-knap på matchet partner → dynamisk infobar + (i)-ikon der
      forklarer matchændringen.
- [ ] Lead-partner-flag på board (mindst 1 intern partner markeres).
- [ ] Fuld test suite grøn.

## Arbejdspakker

> **Fundament før features (2026-07-22, ADR 0016):** Da 1.2 (quiz) og 1.4 (katalog) deler samme
> forudsætninger, bygges det fælles backend-fundament først: `/admin`-rute + rolle-guard,
> business-data-access-mønster (`src/server/tags`), `has_role()` RLS-helper og den delte
> `competence_tag`-taksonomi med admin-CRUD (migration 0005). Herefter køres 1.2 → 1.3 → 1.4 →
> 1.5 → 1.6 i rækkefølge ovenpå fundamentet.

### 1.1 Auth-flow
- Byg login/signup oven på fase 0-beslutningen (Supabase Auth eller eget).
- Rolletildeling ved signup; RLS håndhæver adgang.

> **Status (2026-07-22): leveret + verificeret ende-til-ende i prod (ADR 0014).** Login/signup/
> logout via server-actions, `proxy`-session-refresh, `provisionOwner` (ejer-rolle, service-role),
> og side-guard (`getCurrentUser` → `/login`). UI via tokens (`Field`/`AuthForm`, `/login`,
> `/signup`, `/dashboard`). Bekræftet på Netlify + Supabase eu-north-1: signup → session → ejer-rolle
> → dashboard.
>
> **Hardening (backlog ryddet):** auth-bruger-sletning cascader nu app-data (migration 0004, ingen
> forældreløse rækker); provisioneringsfejl råber i stedet for tavs "ingen rolle"; danske
> fejlbeskeder + `/check-email`-side når e-mailbekræftelse er slået til; migration-til-prod-flow via
> Supabase CLI (ADR 0015, `docs/supabase-migrations.md`). 🔴 Ejer-opgaver: Netlify-region → EU før
> rigtige persondata; Resend-SMTP + gen-aktivér e-mailbekræftelse.

### 1.2 Quiz — admin-UI
- CRUD på spørgsmål. **Preview af quiz inden gem** (eksplicit krav).
- Drag-n-drop til at knytte kompetence-tags til spørgsmål/svar.

> **Status (2026-07-22, ADR 0017):** dependency-fri, leveres i 3 PR'er. **PR 1 (denne):** schema
> (migration 0007: quiz_question/quiz_option/quiz_option_competence_tag + RLS) + `src/server/quiz`
> data-access + spørgsmåls-CRUD på `/admin/quiz` (opret/redigér/slet + op/ned-reorder) +
> `Select`/`TextArea`-komponenter. **PR 2:** options + checkbox-tag-mapping. **PR 3:** `QuizRenderer`
> preview-inden-gem + native HTML5-drag. Ingen dnd-library (op/ned + native drag; @dnd-kit ville
> kræve egen ADR).

### 1.3 Quiz — ejer-flow (conversational)
- Conversational/trinvis flow for ejeren. Svar → kompetence-signal til matching.

> **Status (2026-07-22, ADR 0018):** leveres i 2 PR'er (backend-først). **PR 1 (denne):** migration
> 0008 (`quiz_answer` — første ejer-skrivbare tabel + RLS *write*-policies) + data-access
> (`listPublishedQuestions`, `getMyAnswers`, `saveMyAnswers` via authed klient). **PR 2:**
> `/onboarding`-rute + conversational `OnboardingFlow` (ét spørgsmål pr. skærm, progressindikator,
> firkantede touch-knapper) + `QuizRenderer`-udvidelse (kontrolleret) + kvittering. Scope: fanger
> kun kompetence-signalet; matching (1.5), board-anbefaling (1.6) og pris/kort/booking er senere.

### 1.4 Partner-katalog
- Admin opretter partnere, redigerer profiler, **tildeler tags** (autoritativt).
- Partner kan redigere egen profil-info, men tags er read-only for partner.

> **Status (2026-07-22, ADR 0019):** leveres i ÉN PR (backend + UI samlet — merge-økonomi, CLAUDE.md):
> migration 0009 (`partner_profile` afkoblet fra auth + `partner_profile_competence_tag` M2M +
> admin-only RLS) + `src/server/partners` (reads + admin-CRUD + `setPartnerTags`) + admin-UI
> `/admin/partners` (liste/opret/redigér + checkbox-tag-picker). **Scope:** kun det admin-forfattede
> katalog (det 1.5 matcher imod). Kun sikre
> §5.3-felter; honorarsats (🔴 pris), rating/antal-møder (fase 4), tilgængelighedsvindue (fase 5) er
> udeladt. **Partner-login + self-service-profil-redigering er UDSKUDT → spores i Fase 2** (indgang
> til partner-portalen). `// TODO(mads): partner-login`. Lead-partner-udpegning: `// TODO(ejer): lead-partner regler`.

### 1.5 Board-matching
- Pulje-filtrering på kompetence-tags → match til **2-3 partnere** (ikke 2-6).
- "Udskift"-knap: vælg anden partner fra puljen.
- Dynamisk infobar + (i)-ikon der forklarer hvorfor et match ændrede sig.

### 1.6 Board-anbefaling
- Vis det anbefalede board med partner-profiler (foto, navn, kompetencer, bio).
- Marker lead-partner (mindst 1 intern). ⚠ Tildelingsregler uafklaret — brug
  et midlertidigt flag/manuel markering og `// TODO(ejer): lead-partner regler`.

## Uafklarede punkter berørt i fase 1 (flag, beslut ikke)
- Lead-partner tildelings-/rotationsregler (ejer) — byg manuel markering bag flag.
- Board-livscyklus (ejer) — påvirker ikke selve anbefalingen endnu, men hold
  board-entiteten livscyklus-agnostisk indtil afklaret.

## Bygges IKKE i fase 1
- Booking, video, betaling, honorar, AI, notifikationer, in-app messaging,
  rating. Disse hører til fase 2+.
