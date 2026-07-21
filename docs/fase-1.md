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

### 1.1 Auth-flow
- Byg login/signup oven på fase 0-beslutningen (Supabase Auth eller eget).
- Rolletildeling ved signup; RLS håndhæver adgang.

> **Status (2026-07-21): leveret — mønster på plads (ADR 0014).** Login/signup/logout via
> server-actions, `proxy`-session-refresh, `provisionOwner` (ejer-rolle, service-role), og
> side-guard (`getCurrentUser` → `/login`). UI via tokens (`Field`/`AuthForm`, `/login`,
> `/signup`, `/dashboard`). Logik enhedstestet med injiceret klient; siderne rendrer stub-stien
> kontofrit. 🔴 Mangler: ende-til-ende-verifikation mod et live Supabase-projekt (eu-north-1).

### 1.2 Quiz — admin-UI
- CRUD på spørgsmål. **Preview af quiz inden gem** (eksplicit krav).
- Drag-n-drop til at knytte kompetence-tags til spørgsmål/svar.

### 1.3 Quiz — ejer-flow (conversational)
- Conversational/trinvis flow for ejeren. Svar → kompetence-signal til matching.

### 1.4 Partner-katalog
- Admin opretter partnere, redigerer profiler, **tildeler tags** (autoritativt).
- Partner kan redigere egen profil-info, men tags er read-only for partner.

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
