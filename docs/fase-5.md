# Fase 5 — Honorar, tilgængelighed & dashboard

> Mål: partnere får korrekt honorar for afholdte møder, kan angive hvornår de er
> ledige, og alle roller har et dashboard der viser det de har brug for.
> Forudsætter at fase 4 er grøn. Læs `CLAUDE.md` først.
>
> **Advarsel:** honorarsats, moms og afbudsregler er alle uafklarede hos ejer.
> Byg beregningsmotoren som konfigurerbar; sæt ingen satser.
>
> **Bemærk (2026-08-03):** tilpasset repoet — partner-dashboard og -tilgængelighed
> forudsætter partner-login fra fase 2.8.

## Leverancekriterier (Definition of Done for fase 5)

- [x] Honoraropgørelse pr. partner pr. afholdt møde, med **75 min som grundlag**
      (60 min møde + 15 min betalt forberedelse). *(`/partner/honorar`, `/admin/honorar` — ADR 0051)*
- [x] Honorarsats ligger i **konfiguration/admin**, aldrig i kode. *(`fee_rule`, 0017 — ingen seed, ingen default)*
- [x] Momsbehandling er en konfigurerbar regel, ikke en antagelse. *(`fee_rule.vat_mode`, default `ikke_fastlagt`; koden beregner aldrig en momssats)*
- [x] Afbuds-/udeblivelsesregel er konfigurerbar og kobler til mødestatus fra
      fase 2 (`udeblevet`, `aflyst`). *(`fee_rule.absence_rule`, default `ikke_fastlagt` → linjen er `afventer_regel`)*
- [x] Partner-tilgængelighed: partner kan angive ledige tider; det respekteres i
      booking-flowet fra fase 2. (ADR 0052: `/partner/tilgaengelighed`, vagt i
      `meetings/actions.ts`. Synk til Cal.com-schedules er IKKE bygget — TODO(mads).)
- [x] Ejer-dashboard: kommende møder, board, betalingsstatus. *(`/dashboard`, ADR 0055: næste møde
      med deltagere/forberedelse/Deltag, op til tre møder derefter, boardets sammensætning med lead,
      abonnement/kort/frekvens med CTA hvis kort mangler; tomtilstand → "Start onboarding")*
- [ ] Partner-dashboard: kommende møder, honoraroverblik, egne ratings. *(`/dashboard`: møder,
      månedens honorar via `src/server/fees/` med "ingen sats"/"afventer regel"-tilstande,
      tilgængelighed. **Ratings:** RLS tillader ikke en partner at læse sine egne vurderinger
      (0015), så panelet siger at de ikke vises endnu — TODO(ejer), ingen ny læsevej bygget.)*
- [x] Lead-partner-dashboard: **kompetenceoverblik for boardet** + næste møde. *(ejerens behov vs.
      boardets dækning pr. tag via `computeBoardCoverage`; "Initiér næste møde" fremhæves når intet er
      aftalt. Ejerens behov læses via service-role bag lead-tjek — ADR 0055. Lead-tildeling er
      stadig uafklaret, TODO(ejer).)*
- [ ] Admin-dashboard: boards, partnere, betalinger, honorar, driftstatus. *(Resumé på `/dashboard`
      og honorar for indeværende måned på `/admin/drift` (ADR 0053/0055). **Rest:** PostHog-
      driftstatus — TODO(mads): live nøgle.)*
- [x] Juridisk download-interface til admin (jf. §11-krav) er tilgængeligt (`/admin/juridisk`,
      ADR 0053): indsigtsudtræk (art. 15), dokumentoversigt og henvisning til sletteflowet.
      Interfacet er bygget, ikke indholdet: ToS/honoraraftale ikke udarbejdet (`TODO(ejer)`),
      ingen samtykkelog at eksportere, og ingen admin-sletteaction (se stub-register).
- [x] Fuld test suite grøn, inkl. RLS: en partner må kun se eget honorar
      (positiv **og** negativ case). *(`tests/db/partner-fee-rls.test.ts` — medpartner på samme board er den svære negative case)*

## Arbejdspakker

### 5.1 Honorarberegning
> **Bygget** (ADR 0051): `fee_rule` (0017), `src/server/fees/`, `/admin/honorar`. Satsen er ikke sat — admin indtaster den.

- Grundlag: afholdt møde × 75 min × sats. Sats fra konfiguration.
- ⚠ **Honorarsats er ikke fastlagt (ejer).** Byg motoren, sæt intet tal — og skriv
  aldrig et plausibelt beløb som placeholder (`docs/stub-politik.md`).
- ⚠ **Moms på partner-honorar er uafklaret (ejer)** → momsregel som konfiguration
  med restriktiv default, ikke en antagelse i koden.
- ⚠ **Honorar ved udeblivelse/sent afbud er uafklaret (ejer)** → regel bag
  konfiguration; registrér grundlaget, beregn ikke konsekvensen før beslutning.
- Versionér satser, så en historisk opgørelse ikke ændrer sig retroaktivt — samme
  mønster som prisregler i fase 3.2.
- Feltet til honorargrundlag blev bygget i fase 2.4; her tilføjes logikken.

### 5.2 Honoraropgørelse & udbetaling
> **Bygget** (ADR 0051): opgørelse pr. partner pr. måned + CSV-eksport (`/admin/honorar/eksport`). Ingen bogføringsintegration, og udbetaling er ikke automatiseret.

- Opgørelse pr. partner pr. periode, eksporterbar.
- ⚠ **Regnskabssystem (e-conomic vs. Dinero) er uafklaret (ejer)** → porten i
  `src/lib/accounting/` forbliver på stub; byg en ren eksportgrænseflade, ikke en
  konkret integration.
- Udbetaling er ikke nødvendigvis automatiseret ved launch — afklar med ejer før
  der bygges automatik.

### 5.3 Partner-tilgængelighed
- Partner angiver ledige tider; feeder ind i booking-adapteren fra fase 2.1.
- Forudsætter **partner-login fra fase 2.8** — uden det har partneren ingen indgang
  til at angive noget som helst.
- Respektér at partner **kan redigere egen profil, men ikke egne kompetence-tags**
  (håndhævet ved fravær af write-policy, ADR 0019).
- Åbner samtidig for §5.2's krav om at "udskift" kun viser partnere med kalenderplads
  — filteret blev udskudt i fase 1.5 (`src/server/matching/index.ts`).
- **Bygget (ADR 0052):** migration 0018, `src/server/availability/` (ren algoritme med
  Europe/Copenhagen-håndtering, vagt, actions), `/partner/tilgaengelighed`, og fælles ledige
  vinduer på ejerens `/moeder`. "Udskift"-filteret er stadig ikke koblet: data findes, men
  "kalenderplads" er ikke defineret (stub-register). ⚠ "Ikke angivet" = ubegrænset er en
  pladsholder (TODO(ejer)).

### 5.4 Dashboards
> **Bygget** (ADR 0055): `/dashboard` med en sektion pr. rolle (en bruger med flere roller ser flere),
> `src/server/dashboard/`, honorar-sektion på `/admin/drift`. PostHog-driftstatus står tilbage (TODO(mads)).

- Ejer: kommende møder, board-sammensætning, betalingsstatus.
- Partner: kommende møder, honoraroverblik, egne ratings.
- **Lead-partner:** kompetenceoverblik for boardet + ansvar for næste møde
  (eksplicit rollekrav fra spec V5).
- Admin: boards, partnere, betalinger, honorar, driftstatus fra PostHog.
- Alle dashboards bygget på design-tokens: firkantet, navy/guld, Open Sans,
  tal-først hierarki. Ingen hardcodede farver/spacing.
- ⚠ Lead-partner-dashboardet hviler på hvem der **er** lead — tildelingsreglerne er
  uafklarede, og markeringen ligger stadig bag flaget `leadPartner` (fase 1.6).

### 5.5 Juridisk download-interface (admin)
- Admin kan hente juridiske dokumenter/data samlet (krav fra §11).
- Kobler til GDPR-arkitekturen fra fase 0 (sletteflow, samtykkelog,
  `docs/gdpr/leverandoer-register.md`).
- ⚠ ToS + honoraraftale er uafklaret (ejer) — byg interfacet, ikke indholdet.

## Uafklarede punkter berørt i fase 5 (flag, beslut ikke)

- Honorarsats pr. partner pr. møde (ejer).
- Moms på partner-honorar (ejer).
- Honorar ved udeblivelse/sent afbud (ejer).
- Regnskabssystem: e-conomic vs. Dinero (ejer).
- Lead-partner tildelings- og rotationsregler (ejer) — påvirker dashboardet.
- Board-livscyklus (ejer) — påvirker hvornår honorar og dashboards lukkes ned.
- ToS + honoraraftale (ejer).

## Bygges IKKE i fase 5

- Slutverifikation, dokumentation og overlevering (fase 6).
- Bogføringsintegration (afventer ejerbeslutning).
- In-app messaging — **hele modulet er uafklaret**, byg ikke.
- Branded videolag (RealtimeKit) — kun hvis Cal Video underleverer, bag flag.
