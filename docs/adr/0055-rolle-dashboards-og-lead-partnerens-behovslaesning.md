# 0055 — Rolle-dashboards: hvad der læses hvordan, og lead-partnerens læsevej til ejerens behov

- **Status:** Accepteret — delvist erstattet af 0065 (spørgsmålet om at informere ejeren om lead-aflæsningen er dækket af kontrakten; lead-tildeling og vurderinger er uberørt)
- **Dato:** 2026-10-10
- **Fase:** 5 (5.4)
- **Berører uafklaret punkt:** ja — lead-partner: tildelings- og rotationsregler (ejer); hvad
  vurderinger bruges til / om en partner må se sine egne (ejer); om ejeren skal vide at boardets
  lead ser ejerens kompetencebehov (ToS, ejer)

## Kontekst

`/dashboard` var fire indgangspaneler. Fase 5.4 kræver rigtige dashboards pr. rolle (ejer,
partner, lead-partner, admin), tal-først, bygget skærm-først (ADR 0042). Næsten alt kunne samles
af eksisterende, RLS-scopede læsefunktioner. Tre punkter krævede et valg:

1. **Lead-partnerens kompetenceoverblik** (spec V5) sammenholder ejerens *behov* med boardets
   *dækning*. Behovene stammer fra ejerens quiz-svar, og `quiz_answer` kan kun læses af ejeren
   selv og admin (`quiz_answer_select_owner` / `_admin`, 0008). En partner — også lead — får 0
   rækker.
2. **Partnerens egne ratings.** Fase 5.4 nævner dem. `meeting_rating` kan kun læses af den der
   afgav vurderingen og af admin (0015); den *vurderede* partner ser bevidst ikke sin score,
   fordi det er uafklaret hvad ratings skal bruges til (B-07, ADR 0038).
3. **Admin-dashboardets honorar** (DoD-punkt) manglede på `/admin/drift` (ADR 0053 udskød det
   til honorarskiven).

## Overvejede muligheder

**Lead-partnerens læsevej til ejerens behov**
- *A — ny RLS-policy:* lad en lead-partner læse `quiz_answer` for sit boards ejer. Åbner
  rækker med `free_text` (ejerens egne ord) og option-id'er for en hel rolle, via en
  migration, for et overblik der kun behøver tag-id'er. Svær at tage tilbage og svær at
  afgrænse (policyen ville også gælde alle fremtidige læsere).
- *B — SECURITY DEFINER-funktion/view* der returnerer tag-id'er for et board. Kræver migration
  og er netop den eksponering ADR 0047 advarer mod (`/rest/v1/rpc`).
- *C — service-role i en server-funktion* bag et eksplicit "er lead på dette board"-tjek,
  der kun afleverer tag-id'er. Ingen migration, ingen ny angrebsflade i databasen; samme
  mønster som tilgængelighedens `readBoardCalendars` (ADR 0052) og matchingpuljen (ADR 0022).
- *D — vis ikke behovene*, kun boardets tags. Intet overblik: lead-dashboardet var meningsløst.

**Partnerens egne ratings**
- *A — åbn en læsevej* (view med egen-række-filter som `partner_fee_line`). Foregriber den
  uafklarede beslutning om hvad ratings skal bruges til.
- *B — vis det ikke; sig det højt* og registrér hullet.

**Honorar på admin-drift**
- *A — genbrug `listFeeLines`.* Den sluger læsefejl og svarer `[]`, så en fejlet læsning ville
  vise "0 linjer" — det ADR 0053 netop forbyder.
- *B — en `loadFeeTotals(db, periode)` i `src/server/fees/` der tager klienten og kaster.*
  Samme `buildFeeLines`/`summarizeFees` som partnerens egen opgørelse, så tallene aldrig kan
  afvige.

## Beslutning

**Lead-partnerens behov: C.** `getLeadBoardNeeds(boardId)` (`src/server/dashboard/`) læser via
service-role, men først efter tre tjek, alle udledt af sessionen og aldrig af input: (1) brugeren
har rollen `partner`; (2) brugeren har en katalogprofil (`partner_profile.app_user_id`); (3)
profilen er `is_lead` på præcis det `boardId`. Svarer brugeren ikke på alle tre, returneres
`null` og `quiz_answer` røres ikke (testet: `tests/integration/dashboard.test.ts`). Kun
**tag-id'er** forlader funktionen — aldrig option-id'er eller `free_text`. En læsefejl giver
`null` (vist som "kunne ikke læses"), aldrig en tom liste der ligner "ejeren har ingen behov".
`tests/db/dashboard-read-paths.test.ts` fastholder at RLS *stadig* lukker for partnere — åbnes
`quiz_answer` en dag, fejler testen og denne ADR skal revurderes.

**Dækningen** regnes af den rene `computeBoardCoverage(ownerTagIds, members)`: pr. behov, hvem på
boardet der dækker det. Den vælger ingen partner og foregriber ikke tie-break/rating.

**Hvem er lead** afgøres af `board_partner.is_lead` som den står i data (samme udledning som
`/partner`), uanset flaget `leadPartner` — som kun styrer om markeringen *vises* på
ejer-siderne og om manuel udpegning er slået til. Tildelingsreglerne er stadig ejerens
(`TODO(ejer)`, byggespec §12 pkt. 15).

**Partnerens ratings: B.** Dashboardet viser et panel der siger at vurderinger ikke vises
endnu, og hvorfor. Ingen ny læsevej bygges. `TODO(ejer)` + stub-register: må en partner se sine
egne vurderinger (gennemsnit/antal)? Svaret låser op for en view-læsevej som `partner_fee_line`.

**Admin-honorar: B.** `getOpsOverview` får sektionen `fees` (indeværende måned, dansk tid): sum,
antal beregnede linjer, og linjer pr. status (afventer afbudsregel / ingen sats / ikke registreret /
aflyst), plus antallet af regelversioner så "satsen er ikke fastsat" kan siges. En fejlet sektion
bliver `null` → "—". Admin-resuméet på `/dashboard` genbruger samme aggregator.

**Andre valg, kort:**
- Mappe: `src/server/dashboard/` (domænemappe, ADR 0035) med rene `meetings.ts`/`coverage.ts`
  og læsevejene i `index.ts`. Komponenter i `src/components/Dashboard.tsx` / `LeadDashboard.tsx`
  som rene props-komponenter; ingen nye CSS-klasser ud over `.dash-section` (rytme mellem
  roller) — resten er de eksisterende `.figures`/`.stats`/`.panel`/`.table`.
- "Kommende møde" = planlagt og ikke før nu, **afgrænset til boardets id**: for en admin
  returnerer RLS alle møder, så en bruger der både er admin og ejer/partner ville ellers se
  andres møder under "mine".
- Betalingsstatus på ejerens dashboard er kun medlemskabets egen status/kortstatus/frekvens og
  et link til `/betaling` — trækhistorikken bor dér.

## Konsekvenser

- Positive: alle fire roller har et tal-først-dashboard uden ny migration; lead-partneren får
  det eksplicit krævede kompetenceoverblik; ingen læsevej er åbnet i databasen.
- Negative / pris: en ny service-role-læsevej findes (lead → ejerens behov). Den er smal (kun
  tag-id'er, kun for lead på netop det board), men den er en reel udvidelse af hvem der kan se
  hvad om ejeren, og ejeren er ikke informeret om det — se opfølgning. Dashboardet henter flere
  ting pr. rolle (en bruger med flere roller betaler for flere); målt, ikke antaget, når
  Netlify-omkostningen følges (ADR 0042).
- Kendt kant: en bruger med flere roller (fx admin + ejer) får via RLS "første board" fra
  `getMyBoard` — den samme kant som `/board` og `/betaling` har i dag; mødelisten er afgrænset
  til det board, så den leder ikke til fejl.
- Opfølgning: `TODO(ejer)` — lead-tildeling; partnerens egne vurderinger; skal ejeren
  informeres (vilkår/privatlivstekst) om at boardets lead ser ejerens kompetencebehov?
  `TODO(mads)` — PostHog-driftstatus på admin-resuméet (live nøgle).
