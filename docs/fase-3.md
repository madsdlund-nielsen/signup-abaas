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

> **Status: BETINGET LUKKET 2026-08-26.** 8 af 9 punkter er verificeret og krydset af.
> Punkt 5 er **omskrevet, ikke afkrydset**: kriteriet beskrev den model fasen blev bygget
> efter, og den er siden ændret (ADR 0034). Liveverifikation mod Alunta/QuickPay udestår
> til konti findes — checkliste i `docs/fase-3-rapport.md` §7, som er en gate før
> **produktion**, ikke før fase 4. Begrundelse: rapportens §5.

- [x] Betalingsmekanikken bygget mod porten i `src/lib/payments/` — **ingen direkte
      SDK-kald uden for adapteren**. Interfacet forbliver leverandørneutralt.
      ⚠ Selve Alunta-adapteren er dataflow-afsøgningens leverance (`TODO(mads)`,
      §12 pkt. 10) — API'et er uafsøgt, og en gættet adapter ville bryde stub-politikken.
- [x] Prisregler ligger i **admin-UI og database**, ikke i kode. Ingen beløb er
      hardcodet nogen steder.
- [x] Prisberegner: viser ejeren en pris ud fra boardstørrelse (2-3 partnere) og
      frekvens (4 / 8 / 12 uger).
- [x] Checkout-mekanik via porten (kortregistrering + charge-grundlag); MobilePay
      afventer Alunta-verifikation (`TODO(mads)`).
- [ ] ⚠ **KRITERIET ER FORÆLDET — ikke afkrydset.** Det lød: *"Varierende
      betalingsfrekvenser implementeret: kort registreres ved booking, træk sker ved
      afholdelse."* Modellen er siden ændret til et **fast abonnement der forfalder
      hver 4. uge**, hvor størrelsen afhænger af antal rådgivere og mødefrekvens
      (ADR 0034). Koden implementerer stadig den gamle model — rework spores som
      `docs/backlog.md` B-19 og skal ske før betaling går live.
- [x] Webhook → `membership` i Supabase. Signaturverificeret og **idempotent**.
- [x] Op- og nedgradering af abonnement virker (frekvens og boardstørrelse).
- [x] Betalingsstatus synlig for ejer; fejlede træk håndteres og logges via
      `src/lib/analytics/` (PostHog).
- [x] Fuld test suite grøn, inkl. webhook-integrationstests og RLS på
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
- **Ingen proratering** (rettet 2026-08-04, ADR 0030): med træk-pr-afholdelse findes
  ingen forudbetaling at proratere — §5.9 siger selv *"meeting-fee justeres tilsvarende
  ved næste afholdelse"*. Ny pris/frekvens/boardstørrelse slår igennem ved næste
  afholdte møde, fordi beløbet beregnes ved afholdelses-flippet. Det tidligere
  prorateringskrav her var abonnements-tænkning der ikke matcher betalingsmodellen.
- ⚠ Regnskabssystem (e-conomic vs. Dinero) er uafklaret → byg ikke
  bogføringsintegration endnu; porten i `src/lib/accounting/` holdes på stub.

> **Status (2026-08-04, ADR 0030 + 0031):** leveret i ÉN PR (merge-økonomi). Migration 0013:
> `membership` (én pr. board, frekvens fra quiz-svar), `pricing_rule` (append-only versioner,
> højst én aktiv via partial unique index, authed-læsbar aktiv version), `payment_charge`
> (grundlag pr. afholdt møde, `meeting_id unique`, versionsreference som audit) og
> `payment_webhook_event`. Charge-grundlag oprettes af afholdelses-flippet (kun flipperen —
> `.select`-fix i registerMeetingStatus); provider-træk er afkoblet (admin-processering);
> webhooken er autoritativ for gennemført/fejlet. `/admin/priser` (preview-inden-gem med delt
> `PriceBreakdown`), `/betaling` (pris, medlemskab, kort, frekvens-skift, opkrævninger),
> board-op/nedgradering på `/board` (add/remove med invariant). `/api/webhooks/alunta` bygget
> med ADR 0027-mønstret.
>
> **Opdatering (2026-08-04, ADR 0032):** dataflow-afsøgningen ER kørt mod Aluntas
> OpenAPI-spec, og `AluntaPaymentProvider` er skrevet mod den verificerede form:
> usage-abonnement med øre-parameter (`meeting_fee_oere` à 1 øre — vores `pricing_rule`
> forbliver den autoritative prisberegner), checkout-session til kortregistrering,
> `Signature`-webhook (HMAC-SHA256 hex) med afledt event-id, charge-livscyklus
> afventer → rapporteret → gennemført/fejlet (migration 0014).
> **Fund:** MobilePay er IKKE en Alunta-gateway (afgøres af gateway-valget
> OnPay/Stripe/QuickPay), og trækket opkræves som periodefaktura — ikke pr. møde
> (§4-nuance, ejerne skal orienteres).
>
> **DoD krydses IKKE af endnu:** rest er Alunta-UI-opsætning (plan + parameter +
> webhook-secret + interval), gateway-valg, og live-verifikation i test_mode.
> Ingen prisregel er aktiv før admin/ejer sætter tal.
>
> **Flag:** startpris/frekvensfaktorer (ejer — struktur uden værdier), moms (ejer — rå øre),
> fejlet træk vs. honorar (ejer — kun registrering), prisregel-pinning for eksisterende aftaler
> (ejer — spec-tro default: ny pris ved næste afholdelse). Samlet i `docs/stub-register.md`.

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
