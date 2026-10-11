# Fase 5 — rapport: honorar, tilgængelighed, dashboards og juridisk interface

> Hvad fase 5 leverede, hvad der er verificeret, og hvad der mangler før fasen kan kaldes
> lukket. Samme form som `docs/fase-2-rapport.md`, `docs/fase-3-rapport.md` og
> `docs/fase-4-rapport.md`.
>
> Status 2026-10-11: **bygget skærm-først, ikke lukket.** Otte af elleve DoD-punkter er
> opfyldt. Tre er delvist opfyldt: partner-tilgængelighed i booking, partnerens egne ratings
> og PostHog-driftstatus. Honorarsatser, moms, afbudsregel og regnskabssystem er ejerens
> beslutninger, og de er ikke sat. Lukning er Mads' beslutning.
> Kilder: `docs/fase-5.md`, ADR 0051, 0052, 0053, 0055, `docs/stub-register.md`, `docs/backlog.md`.

## 1. Hvad fase 5 leverede (🟢 bygget)

| Arbejdspakke | Leverance | Hvor / ADR |
|---|---|---|
| **5.1 Honorarberegning** | Versionerede regler (`fee_rule`, append-only med `effective_from`, ikke `is_active`). Et møde afregnes efter den regel med seneste `effective_from <= starts_at`. Beregning er en ren funktion: `round(sats × (duration + prep) / 60)`, grundlag 75 min. Udfald: `beregnet`, `afventer_regel`, `ingen_sats`, `ikke_registreret`, `aflyst`. Ingen seed i kode. | Migration `0017_partner_fee.sql`; `src/server/fees/algorithm.ts`, `period.ts`, `lines.ts`; `/admin/honorar`; ADR 0051 |
| **5.1 Partnervisning** | `partner_fee_line` er en view med `security_invoker` og filteret `app_user_id = auth.uid() or has_role('admin')`. Den viser grundlag, ikke beløb. Partneren ser kun eget honorar, også når medpartnere står på samme møde. | Migration `0017`; `/partner/honorar`; ADR 0051 pkt. 2 |
| **5.1 Sats, moms og afbudsregel som konfiguration** | `hourly_rate_minor` (øre pr. time), `vat_mode` (default `ikke_fastlagt`), `absence_rule` (default `ikke_fastlagt`). Koden beregner aldrig en momssats. | ADR 0051 pkt. 1 og 3 |
| **5.2 Opgørelse og CSV-eksport** | Opgørelse pr. partner pr. kalendermåned (`Europe/Copenhagen`). CSV efter RFC 4180, UTF-8 BOM, formel-injektion neutraliseret. Beløb i rå øre. | `/admin/honorar/eksport` (route); `src/server/fees/csv.ts`; ADR 0051 pkt. 4 |
| **5.2 Regnskab (stub)** | `src/lib/accounting/` er uberørt og stub. Ingen integration med e-conomic eller Dinero. Udbetaling er ikke automatiseret. | `src/lib/accounting/`; ADR 0051 |
| **5.3 Partner-tilgængelighed** | Ugevinduer i lokal vægurstid (`partner_availability`) og fravær med note (`partner_absence`). Oversættelse til absolutte tidspunkter ét sted (`algorithm.ts`, `Intl`). Vagt i `meetings/actions.ts` (book, initiér, flyt) og `assertBoardAvailable`. Ejeren får kun fælles vinduer, aldrig rækker eller noter. | Migration `0018_partner_availability.sql`; `src/server/availability/` (`algorithm.ts`, `guard.ts`, `actions.ts`, `validation.ts`); `/partner/tilgaengelighed`; ADR 0052 |
| **5.4 Ejer-dashboard** | Næste møde med deltagere og forberedelse, op til tre kommende møder, boardets sammensætning med lead, medlemskab/kort/frekvens med CTA når kort mangler. Tomtilstand: «Start onboarding». | `/dashboard`; `src/components/Dashboard.tsx`; `src/server/dashboard/`; ADR 0055 |
| **5.4 Partner-dashboard** | Kommende møder, månedens honorar via `listMyFeeLines` med «ingen sats» og «afventer regel» som tilstande, tilgængelighed. | `/dashboard`; `src/server/fees/`; ADR 0055 |
| **5.4 Lead-partner-dashboard** | Kompetenceoverblik: ejerens behov (tag-id'er) mod boardets dækning (`computeBoardCoverage`). Læsning sker via service-role bag et tre-leds tjek (rolle, profil, `is_lead` på præcis det board). Næste møde, med «Initiér næste møde» fremhævet når intet er aftalt. | `src/components/LeadDashboard.tsx`; `getLeadBoardNeeds` i `src/server/dashboard/index.ts`; ADR 0055 |
| **5.4 Admin-drift** | `/admin/drift`: integrationsstatus via factoryen (`real` / `demo` / `stub`, og flag slået fra vs. nøgler mangler). Driftstal med RLS-læsning; en sektion der fejler vises som «—». Honorar for indeværende måned. | `src/server/admin/ops.ts`, `ops-summary.ts`, `integrations.ts`; ADR 0053, 0055 |
| **5.5 Juridisk download-interface** | `/admin/juridisk`: indsigtsudtræk (art. 15) via `POST /api/admin/indsigt` (JSON, `no-store`, admin-tjek før service-role, afviser cross-site). Udtrækket har en eksplicit afgrænsning i selve filen. Dokumentoversigt og henvisning til sletteflowet. | `/admin/juridisk`; `src/app/api/admin/indsigt/route.ts`; `src/server/admin/subject-*.ts`, `legal.ts`; ADR 0053; udvidet med navn, telefon, tidszone og SMS-samtykke i ADR 0061 |

**Bevidst ikke leveret:** bogføringsintegration, automatisk udbetaling, sletteaction i admin
(egen skive efter ejer/jura-afklaring, `docs/gdpr/sletteflow.md`), og samtykkelog (ingen tabel).

## 2. Verifikation

| Gate | Status |
|---|---|
| `npm run lint` (kørt lokalt 2026-10-11) | 🟢 exit 0 |
| CI på HEAD `6536fd8` (run `38111121859`) | 🟢 Lint, Typecheck, Build, Unit tests, **Integration & DB tests** — alle `success` |
| `npm run test:db` lokalt | ❌ Ikke kørt — Docker mangler (`docs/backlog.md` B-13). CI er gaten for RLS. |
| Test-filer for fasen | Findes: db: `partner-fee-rls.test.ts` (medpartner-negativ), `partner-availability-rls.test.ts`, `dashboard-read-paths.test.ts`; integration: `fees.test.ts`, `availability.test.ts`, `dashboard.test.ts`, `admin-subject-access.test.ts`, `admin-integrations.test.ts`; unit: `fees.test.ts`, `availability-algorithm.test.ts`, `dashboard-helpers.test.ts`, `ops-summary.test.ts`, `subject-access.test.ts`, `fee-statement.test.tsx`. Testcases er ikke gennemlæst i denne rapport. |
| Ende-til-ende mod rigtige data | ❌ Ingen sats er sat i repoet (ingen seed), så ingen opgørelse har et beløb. Ingen Cal.com-kald er kørt, så tilgængelighed er kun testet mod Supabase-laget og mod den rene algoritme. |

## 3. DoD-status punkt for punkt (`docs/fase-5.md`)

| # | Punkt | Status | Begrundelse |
|---|---|---|---|
| 1 | Honoraropgørelse pr. partner pr. afholdt møde, 75 min som grundlag | ✅ | Bygget (ADR 0051, migration 0017). Formlen bruger `duration + prep`. Der er ingen sats, så beløbet er stadig «ingen sats» (ejer). |
| 2 | Honorarsats i konfiguration, aldrig i kode | ✅ | `fee_rule` uden seed. **Forbehold:** demo-seed (ADR 0043) indsætter en åbenlyst falsk regel på 1 kr/t, kun i demo-data. |
| 3 | Momsbehandling er en konfigurerbar regel | ✅ | `fee_rule.vat_mode`, default `ikke_fastlagt`. Koden beregner aldrig en momssats. |
| 4 | Afbuds-/udeblivelsesregel konfigurerbar, kobler til mødestatus | ✅ | `fee_rule.absence_rule`, default `ikke_fastlagt` → linjen er `afventer_regel`. Den konkrete konsekvens er ejerens. |
| 5 | Partner-tilgængelighed respekteres i booking-flowet | **delvist** | Vagten i app-flowene (book, initiér, flyt) er bygget og testet i unit- og integrationstests (`availability.test.ts`, ADR 0052). **Ikke bygget:** synk til Cal.com-schedules. En booking oprettet direkte i Cal.com omgår vagten. «Udskift»-filteret bruger stadig hele puljen. `fase-5.md` har tjekboksen afkrydset; punktet er ikke opfyldt i sin fulde form. |
| 6 | Ejer-dashboard: kommende møder, board, betalingsstatus | ✅ | `/dashboard` (ADR 0055). Betalingsstatus er medlemskab, kortstatus og frekvens, med link til `/betaling` for trækhistorikken. |
| 7 | Partner-dashboard: kommende møder, honoraroverblik, egne ratings | **delvist** | Møder, honorar og tilgængelighed er bygget. **Egne ratings vises ikke:** RLS (0015) lader kun afgiveren og admin læse `meeting_rating`. Panelet siger det højt. Ingen ny læsevej er bygget (ADR 0055). `fase-5.md` har tjekboksen afkrydset, men punktet er ikke opfyldt. |
| 8 | Lead-partner-dashboard: kompetenceoverblik + næste møde | ✅ (med forbehold) | Overblik og næste møde er bygget (ADR 0055). **Forbehold:** lead-tildeling er uafklaret (ejer), så «lead» er det der står i data. |
| 9 | Admin-dashboard: boards, partnere, betalinger, honorar, driftstatus fra PostHog | **delvist** | Boards, partnere, betalinger og honorar er bygget (ADR 0053, 0055). **Ikke bygget:** PostHog-driftstatus (fejlrate, seneste fejl). Analytics-porten er stub uden query-grænseflade. Siden linker til PostHog. Ingen falske tal (TODO(mads)). |
| 10 | Juridisk download-interface til admin (§11) | ✅ (interface) / ❌ (indhold) | `/admin/juridisk` er bygget (ADR 0053). **Indholdet findes ikke:** ToS og honoraraftale er «Ikke udarbejdet — afventer ejer». Der er ingen samtykkelog at eksportere, og ingen admin-sletteaction. |
| 11 | Fuld test suite grøn, inkl. RLS: partner ser kun eget honorar (positiv og negativ) | ✅ (CI) | CI er grøn på HEAD, inkl. Integration & DB tests. `tests/db/partner-fee-rls.test.ts` findes med medpartner-negativ-case. Lokal db-kørsel mangler (B-13). |

**Oversigt:** 8 ✅ (heraf tre med forbehold: punkt 2 (demo-seed), 8 (lead-tildeling) og 10 (indhold)),
3 delvist (punkt 5, 7, 9). Tjekboksene i `docs/fase-5.md` er afkrydset for alle elleve. Det
er en afvigelse for punkt 5, 7 og 9: de er ikke opfyldt i den form DoD beskriver.

## 4. 🔴 FLAG — uafklarede punkter berørt i fase 5

Alle står i kode med `TODO(ejer)` / `TODO(mads)` og i `docs/stub-register.md`. Ingen er besluttet her.

### 4.1 Åbne 🔴 — ejer (Andreas/Mette)

| Punkt | Hvor | Hvad det blokerer |
|---|---|---|
| **Honorarsats pr. partner pr. møde** (§12 pkt. 1) | `fee_rule` (0017), `/admin/honorar` | Alle beløb. Uden sats er linjen «ingen sats». ADR 0051 |
| **Moms på partner-honorar** (§12 pkt. 14) | `fee_rule.vat_mode`, `src/server/fees/algorithm.ts` | Om beløbet er inkl. eller ekskl. moms. Koden beregner aldrig en momssats. ADR 0051 |
| **Honorar ved udeblivelse/sent afbud** (§12 pkt. 13) | `fee_rule.absence_rule` | Konsekvensen af registrerede afbud. Mellemting (fx delvist honorar) er en ny enum-beslutning. ADR 0051 |
| **Regnskabssystem: e-conomic vs. Dinero** | `src/lib/accounting/` (stub, `FLAG_ACCOUNTING`) | Eksportformatet og en eventuel integration. CLAUDE.md lister punktet som ikke afgjort. |
| **Udbetaling automatiseres eller ej** | `/admin/honorar` (kun CSV) | Om der skal tages et snapshot af beløb. ADR 0051 (konsekvenser) |
| **«Ikke angivet» tilgængelighed = ubegrænset?** | `src/server/availability/algorithm.ts` (`isRestricted`) | Om en partner uden angivet tilgængelighed kan bookes overalt. ADR 0052 |
| **«Kalenderplads»** (Udskift-filteret) | `src/server/matching/index.ts:101` | Hvor mange ledige timer, i hvilken periode, og om en partner uden angivelse tæller med. Stub-register |
| **Må en partner se sine egne ratings?** | `src/components/Dashboard.tsx` (`RatingsPanel`) | Om en ny læsevej bygges (fx en view med egen-række-filter). ADR 0055, 0038 |
| **Lead-tildeling og -rotation** (§12 pkt. 15) | `src/server/boards/actions.ts`, `src/server/dashboard/index.ts` | Hvem der er lead. Dashboardet hviler på det. ADR 0055 |
| **Skal ejeren informeres om boardets lead-aflæsning?** | Vilkår og privatlivstekst | Om ejeren ved at lead ser hendes kompetencebehov. ADR 0055 |
| **ToS og honoraraftale** | `src/server/admin/legal.ts` (`Ikke udarbejdet`) | Indholdet i `/admin/juridisk`. Honoraraftalen hænger sammen med sats og moms. ADR 0053 |
| **Samtykketekst og samtykkelog** (`consent_event`) | `src/server/consent/` (ingen tabel) | En CSV-eksport af samtykker kan først bygges, når teksten og kategorierne er besluttet. ADR 0053 |
| **Modtagne vurderinger i partnerens indsigtsudtræk** | `src/server/admin/subject-access.ts` (udeladt) | Om de må med (evt. uden afgiver). Jura. ADR 0053 |
| **Opbevaringspligt vs. sletning** og slette-SLA | `docs/gdpr/sletteflow.md` | Egen skive: en admin-sletteaction bygges først efter afklaring. ADR 0053 |
| **Board-livscyklus** (hvornår slutter et board) | `docs/fase-5.md` (uafklaret, ingen ADR) | Hvornår honorar og dashboards lukkes ned. |

### 4.2 Åbne 🔴 — Mads (teknisk og drift)

| Punkt | Hvor | Hvad det blokerer |
|---|---|---|
| **Cal.com-synk af `partner_availability`** (envejs, efter B-23 og med Teams-konto, L-1/L-3) | `src/server/availability/` | Booking direkte i Cal.com omgår vagten. Hører under liveverifikationen i `docs/spikes/multi-host.md`. ADR 0052 |
| **PostHog-driftstatus** (live nøgle og læse-adapter bag analytics-porten) | `src/app/admin/drift/page.tsx`, `src/lib/analytics/` | Fejlrate og seneste fejl på driftssiden. ADR 0053. Ingen falske tal før da. |
| **Persistent revisionslog over indsigtsudtræk** (tabel + RLS) | `src/server/admin/subject-request.ts` | Der er i dag kun én logline uden persondata. Stub-register |
| **Driftsskærmen tæller ejere via `app_user`-policy** | `src/server/admin/ops.ts` | Admin-select-policy findes siden 0024 (ADR 0061), men driftstallet bruger den ikke endnu. ADR 0053, 0061 |
| **Dashboards er dynamiske uden cache** (B-27) | `next.config.ts`, `netlify.toml` | Hver dashboard-visning er en serverfunktion. Beslutningen om Cache Components er Mads'. Funktionsregionen (US East) er en del af samme punkt. |

## 5. Fund undervejs — kodegennemgang

Denne rapport er skrevet ud fra ADR'er, stub-register og backlog. Den er **ikke** en ny
kodegennemgang. Fasens egne ADR'er peger på disse forhold:

- **Honorar beregnes ved læsning, ikke gemmes.** En ændret registrering ændrer opgørelsen
  bagefter. Det er acceptabelt, så længe udbetaling er manuel. Ved automatisk udbetaling skal
  der tages et snapshot (ADR 0051, konsekvenser).
- **Tilgængelighed står kun i Supabase.** En booking oprettet direkte i Cal.com omgår vagten.
  ADR 0052 nævner den først blandt de negative konsekvenser.
- **Lead-partneren læser ejerens behov via service-role**, bag et tre-leds tjek. Det er en reel
  udvidelse af hvem der kan se hvad om ejeren, og ejeren er ikke informeret om det (ADR 0055).
- **Indsigtsudtrækket er ikke revisionssporet.** Der er ingen persistent log over hvem der har
  hentet et udtræk (stub-register, ADR 0053).

## 6. Hvad der skal til før fasen kan kaldes lukket

Fasen lukkes **betinget**, på samme måde som fase 2-4, hvis Mads accepterer det. Følgende skal
ligge klar, og intet der mangler må stå som stille stub:

**A. Uden ejerbeslutning, kan gøres nu**

1. Afkryds i `docs/fase-5.md` rettes for punkt 5, 7 og 9, så de ikke står som opfyldt.
   Det er en opfølgning, ikke en del af denne rapport.

**B. Ejerbeslutninger**

3. Honorarsats, moms og afbudsregel. Først da viser opgørelsen beløb.
4. Regnskabssystem (e-conomic eller Dinero) og om udbetaling skal automatiseres.
5. «Ikke angivet» og «kalenderplads»: svaret bestemmer om Udskift-filteret kan bygges.
6. Ratings: må partneren se dem? Det bestemmer om RatingsPanel bliver en læsevej.
7. ToS og honoraraftale. Uden dem er `/admin/juridisk` kun et interface.

**C. Med leverandørkonti og drift (Mads)**

8. Cal.com-synk af tilgængelighed, eller en bevidst accept af at direkte Cal.com-bookinger
   omgår vagten. Hører under liveverifikationen i `docs/spikes/multi-host.md` (ADR 0052).
9. PostHog-driftstatus med live nøgle.
10. Beslutning om B-27 (cache-model og funktionsregion).

**D. Gate før produktion (ikke før fase-lukning)**

11. `FLAG_DEMO` slås fra (`docs/fase-6.md` §6.4), og demo-data ryddes før launch (`demo-clean`,
    ADR 0057). Den demo-seedede 1 kr-regel (ADR 0051) må ikke ligge i produktion.
12. Stub-register gennemgås (fase 6 §6.4).

## 7. Næste skridt

Fase 5's kodedel er færdig for det der kan bygges uden ejerbeslutninger. Næste skridt er ejer-
beslutningerne i §4.1 og Cal.com-synken af tilgængelighed (§4.2). Honorarmotoren tager satserne
som konfiguration, og der kræves ingen ny kode før beslutningerne er truffet.

Fase 4 er rapporteret i `docs/fase-4-rapport.md`. Ratings-panelet på partnerens dashboard viser
en forklaring, indtil ejeren har besluttet om partneren må se sine egne ratings.
