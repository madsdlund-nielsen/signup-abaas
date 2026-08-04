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

- [ ] Honoraropgørelse pr. partner pr. afholdt møde, med **75 min som grundlag**
      (60 min møde + 15 min betalt forberedelse).
- [ ] Honorarsats ligger i **konfiguration/admin**, aldrig i kode.
- [ ] Momsbehandling er en konfigurerbar regel, ikke en antagelse.
- [ ] Afbuds-/udeblivelsesregel er konfigurerbar og kobler til mødestatus fra
      fase 2 (`udeblevet`, `aflyst`).
- [ ] Partner-tilgængelighed: partner kan angive ledige tider; det respekteres i
      booking-flowet fra fase 2.
- [ ] Ejer-dashboard: kommende møder, board, betalingsstatus.
- [ ] Partner-dashboard: kommende møder, honoraroverblik, egne ratings.
- [ ] Lead-partner-dashboard: **kompetenceoverblik for boardet** + næste møde.
- [ ] Admin-dashboard: boards, partnere, betalinger, honorar, driftstatus.
- [ ] Juridisk download-interface til admin (jf. §11-krav) er tilgængeligt.
- [ ] Fuld test suite grøn, inkl. RLS: en partner må kun se eget honorar
      (positiv **og** negativ case).

## Arbejdspakker

### 5.1 Honorarberegning
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

### 5.4 Dashboards
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
