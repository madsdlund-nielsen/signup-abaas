# Fase 3 — Betaling

> Mål: en ejer kan se en pris, købe sit board, og betalinger kan trækkes med
> varierende betalingsfrekvenser. Admin kan styre prisregler uden kodeændring.
> Forudsætter at fase 2 er grøn. Læs `CLAUDE.md` først.
>
> **Advarsel:** denne fase er den mest ejer-afhængige i hele projektet. Startpris,
> honorarsats og moms er alle uafklarede. Byg mekanikken, ikke tallene.
>
> **Bemærk (2026-08-03):** tilpasset repoet — **Alunta er besluttet** (ADR 0023), så
> Stripe Billing er ude; porten hedder `src/lib/payments/`, og tabellen `membership`
> i ental (ADR 0006).

## Leverancekriterier (Definition of Done for fase 3)

- [ ] Betalingsadapteren udfyldt i `src/lib/payments/` — **ingen direkte SDK-kald
      uden for adapteren**. Interfacet forbliver leverandørneutralt.
- [ ] Prisregler ligger i **admin-UI og database**, ikke i kode. Ingen beløb er
      hardcodet nogen steder.
- [ ] Prisberegner: viser ejeren en pris ud fra boardstørrelse (2-3 partnere) og
      frekvens (4 / 8 / 12 uger).
- [ ] Checkout via Alunta, inkl. MobilePay som betalingsmetode.
- [ ] **Varierende betalingsfrekvenser** implementeret: kort registreres ved
      booking, træk sker ved afholdelse.
- [ ] Webhook → `membership` i Supabase. Signaturverificeret og **idempotent**.
- [ ] Op- og nedgradering af abonnement virker (frekvens og boardstørrelse).
- [ ] Betalingsstatus synlig for ejer; fejlede træk håndteres og logges via
      `src/lib/analytics/` (PostHog).
- [ ] Fuld test suite grøn, inkl. webhook-integrationstests og RLS på
      `membership` (en ejer må aldrig se en andens betalingsdata) — positive **og**
      negative cases.

## Arbejdspakker

### 3.1 Betalingsadapter (Alunta)
- Udfyld den eksisterende port i `src/lib/payments/` med et domænevendt interface:
  opret kunde, registrér kort, træk beløb, opsig, opgradér.
- ✅ **Alunta er besluttet** (ADR 0023) — erstatter Stripe Billing. Interfacet holdes
  alligevel leverandørneutralt (ADR 0004), så et skifte forbliver en
  implementeringsdetalje.
- Aktiveres af `FLAG_PAYMENTS` + Alunta-nøgler; uden dem forbliver stubben aktiv, og
  den **kaster** frem for at foregive succes (`docs/stub-politik.md`).
- ⚠ **Alunta/Supabase-dataflow (Mads):** kortregistrering, varierende
  betalingsfrekvenser, webhooks og signaturverifikation skal verificeres mod
  GDPR-arkitekturen fra fase 0 før produktionsbrug.
- ⚠ **MobilePay gennem Alunta (Mads):** understøttelsen følger ikke automatisk med
  betalingsvalget — verificér før 3.4 bygges færdig. `// TODO(mads): MobilePay via Alunta`.

### 3.2 Prisregler i admin
- Prisregler som data: pris pr. partner, frekvenstillæg/-rabat, evt. startgebyr.
- Admin-UI til at redigere reglerne, med **preview inden gem** (samme mønster
  som quiz i fase 1 — genbrug `QuizRenderer`-tilgangen fra ADR 0017).
- Versionér prisregler, så en eksisterende aftale ikke ændrer sig når prisen gør.
- ⚠ **Startpris er ikke fastlagt (ejer).** Byg regelmotoren; sæt ingen tal, og skriv
  aldrig et plausibelt beløb som placeholder — registrér i stedet en stub der fejler.

### 3.3 Prisberegner (ejer-vendt)
- Beregner pris ud fra 2-3 partnere × frekvens (4/8/12 uger).
- Vis prisen transparent — hvad der betales, hvornår, og pr. møde.
- Sprogbrug: **"varierende betalingsfrekvenser"**, aldrig "pay-per-meeting".
- Åbner samtidig for at board-anbefalingens infobar kan vise pris i stedet for
  kompetence-delta (fase 1.5 byggede kompetence-delta, fordi prisen manglede — se
  `docs/fase-1-rapport.md`).

### 3.4 Checkout
- Alunta-checkout med kort + MobilePay som betalingsmetoder.
- Kortregistrering ved booking; **træk først ved afholdt møde** (kobling til
  mødestatus fra fase 2).
- Stylet med design-tokens: firkantet, navy/guld, Open Sans.

### 3.5 Webhooks → membership
- Verificér signatur; afvis ikke-verificerede.
- **Idempotens er et krav** — samme event må ikke skabe dublet-medlemskab eller
  dobbelttræk.
- `membership` i Supabase er sandhedskilde for abonnementstilstand. Migration med
  RLS-policies i samme fil (ADR 0007), ental-navngivning (ADR 0006).
- Fejlede træk: registrér, notificér (notifikationsmotor bygges i fase 4), og
  log via analytics-porten.
- **Hverken signaturverifikation eller idempotens må stubbes.**

### 3.6 Op- og nedgradering
- Skift af frekvens (4 ↔ 8 ↔ 12 uger) og boardstørrelse (2 ↔ 3 partnere).
- Boardstørrelsen skal respektere fase 1's invariant: 2-3 partnere, mindst 1 intern
  (`src/server/matching/algorithm.ts`).
- Definér proratering som **konfigurerbar regel**, ikke hardcodet logik.
- ⚠ Regnskabssystem (e-conomic vs. Dinero) er uafklaret → byg ikke
  bogføringsintegration endnu; porten i `src/lib/accounting/` holdes på stub.

## Uafklarede punkter berørt i fase 3 (flag, beslut ikke)

- Startpris / meeting-fee (ejer) — **blokerer ikke byg, kun tal.**
- Honorarsats pr. partner pr. møde (ejer) — binder prisen nedefra.
- Moms på partner-honorar (ejer) — påvirker beløbsvisning og bogføring.
- Regnskabssystem: e-conomic vs. Dinero (ejer).
- Honorar ved udeblivelse/sent afbud (ejer) — kobler mødestatus til træk.
- Alunta/Supabase-dataflow og GDPR-verifikation (Mads).
- MobilePay gennem Alunta (Mads).

## Bygges IKKE i fase 3

- Honoraropgørelse og udbetaling til partnere (fase 5).
- Bogføringsintegration mod e-conomic/Dinero (afventer ejerbeslutning).
- Notifikationer om betaling (motoren bygges i fase 4).
- Rating, AI, forberedelse (fase 4).
