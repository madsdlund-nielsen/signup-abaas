# Backlog — drift, gæld og hygiejne

> Åbne **tekniske** punkter der ikke hører hjemme et andet sted. Rækkefølgen er
> prioriteret: øverst = misinformerer eller blokerer noget andet lige nu.
>
> Oprettet 2026-08-26.

## Hvad hører til her — og hvad gør ikke

Backloggen er til punkter hvor **beslutningen allerede er truffet**, men koden eller
dokumentationen ikke er fulgt med — plus hygiejne og gæld. Den er bevidst adskilt fra:

| Spores et andet sted | Hvor | Hvad |
|---|---|---|
| Aktive stubs + beslutnings-pladsholdere | `docs/stub-register.md` | Synlige huller med ejer, jf. `docs/stub-politik.md` |
| Uafklarede forretnings-/leverandørpunkter | `CLAUDE.md` (§ Uafklarede punkter) | Ting Claude Code **ikke** må beslutte |
| Fase-specifikke åbne 🔴 punkter | `docs/fase-N-rapport.md` | Fx Netlify Functions-region = EU (fase 1, `netlify.toml`) |
| Arkitektur-/leverandørvalg | `docs/adr/` | ADR-on-ship, obligatorisk (ADR 0042) |

Dubler ikke et punkt herind fra en af de fire — referér det i stedet.

## Sådan bruges den

- Ét punkt = én række. **Luk punktet ved at slette rækken i samme PR som fixet** — samme
  regel som stub-registret.
- ID'er er stabile og genbruges ikke, så de kan refereres i commits og PR'er.
- Viser et punkt sig at være en rigtig beslutning: skriv en ADR og flyt det derhen.

---

## 1. Misinformerer eller blokerer nu

| ID | Punkt | Hvor | Hvorfor det haster | Ejer |
|---|---|---|---|---|
| **B-22** | **`public.rls_auto_enable()` findes i produktionsdatabasen, men ikke i repoet.** Supabase' linter rapporterer den som en `SECURITY DEFINER`-funktion eksekverbar for `anon` og `authenticated`. Den står hverken i `supabase/migrations/` eller i git-historikken (`git log -S` giver nul træf), så den er anvendt uden om migrationsflowet. | Produktions-DB (ikke i repo) | Migrationerne er sandhedskilden for schemaet (ADR 0006/0015) — her er de det ikke. Ukendt SECURITY DEFINER-kode, kaldbar af uautentificerede brugere via `/rest/v1/rpc/rls_auto_enable`, kan ikke vurderes uden at se dens krop. Første skridt: `select prosrc, prorettype::regtype, proowner::regrole from pg_proc where proname = 'rls_auto_enable';` — returtypen `trigger`/`event_trigger` betyder at Postgres selv afviser direkte kald, og så er den kun et dokumentationshul. Ellers: vurder kroppen, og enten skriv den ind i en migration eller fjern den. | Mads |

| **B-27** | **Intet caches — hver sidevisning koster en serverfunktion.** Målt på `sua-abaas.netlify.app` 2026-09-21: kold TTFB på `/` **2,60 s**, varm **0,31-0,66 s**, alt med `no-store`. ~~Duplikerede brugeropslag~~ → lukket af **ADR 0049** (2 opslag → 1, målt). ~~Hele siden ventede på sessionen før første byte~~ → lukket af **ADR 0050**: `SiteHeader` er auth-fri, nav'en streames — TTFB på `/` **162 ms → 15 ms** med en simuleret rundtur på 150 ms. **Tilbage står:** **(a)** ruterne er stadig **dynamiske**, så der caches intet på CDN'en. Årsagen er nu isoleret, og vejen videre er Next 16's **Cache Components** (`cacheComponents: true` → PPR: statisk skal + streamede huller). **Afprøvet:** buildet fejler på **19** filer med `Route segment config "dynamic" is not compatible with nextConfig.cacheComponents` — de bevidste `force-dynamic`-markeringer på de session-afhængige ruter. Migrationen vender cache-modellen om og kræver en Suspense-gennemgang af hver authed side. **(b)** Funktionerne kører i **US East (Ohio)**, mens Supabase ligger i **eu-north-1 (Stockholm)**; funktions-regionen kræver Netlify Pro. **Mads, 2026-10-11: Ohio er accepteret indtil der kører rigtige kort** — regionen skal flyttes til EU før betaling går live (og `netlify.toml`/`docs/fase-2-rapport.md` skal så bringes i overensstemmelse med den faktiske region). | (a) `next.config.ts` + de 19 `export const dynamic`-linjer; (b) `netlify.toml`, Netlify-plan | **(a) er ikke Claude Codes valg alene** — det er hele rammeværkets cache-semantik og har egen risiko på Netlify. Beslutningsgrundlaget er nu målt frem for gættet (se ADR 0050). **(b)** kræver Pro og skal alligevel træffes for EU-residens-kravet. ⚠ Tallene er målt gennem en agent-proxy / lokalt, ikke fra en dansk forbindelse. Mål igen fra DK før der konkluderes på absolutte tal. | Mads (a: beslut migration) + ejer/Mads (b: plan) |

## 2. Drift der kræver en beslutning

| ID | Punkt | Hvor | Handling | Ejer |
|---|---|---|---|---|
| **B-07** | **Tie-break-punktet har ingen ejer.** Byggespec §5.2 flager det og henviser til §12 — men punktet findes ikke i §12's tabel (numrene 3, 20 og 23 mangler). Det står heller ikke i `CLAUDE.md`'s liste over uafklarede punkter. | `src/server/matching/algorithm.ts:47`, `docs/fase-1-rapport.md` §3 | Tilføj punktet til `CLAUDE.md`'s ejer-liste (eller få §12 rettet), så det ikke falder mellem to stole. Koden holder en neutral, deterministisk pladsholder — registreret i stub-registret. | Ejer |
| **B-35** | **Alunta kan ikke fakturere hver 4. uge.** ADR 0034 kræver et abonnement med 4-ugers kadence; Aluntas OpenAPI-spec kender kun månedsintervaller (1/3/4/6/12) på plan, abonnement, checkout og `PUT /subscriptions/{uuid}/interval` — uger og dage findes ikke (fundet ved genlæsning af spec'en 2026-10-10, ADR 0056). Koden har vores egen 28-dages periodekæde i Supabase og sætter *prisen* på Aluntas abonnement, men Aluntas egen faktureringscyklus kan ikke matche. | `src/lib/payments/alunta.ts` (`upsertSubscription`, `TODO(mads)`), `docs/accounts-to-create.md` | Vælg: **(a)** en månedlig/4-måneders Alunta-kadence med ejerens accept, **(b)** engangsfaktura pr. periode (`POST /invoices` med `Idempotency-Key` = `payment_charge.id`, passer til 28-dages-kæden, men kort-træk uden kundeklik er ikke læsbart ud af spec'en), eller **(c)** spørg Alunta om en 28-dages mulighed uden for API'et. Ikke Claude Codes valg (leverandør + forretningsmodel). Skal afklares før betaling går live. | Mads |

## 3. Leverandør-drift i kode (venter på sin fase)

> Ikke hastende: koden er stub-aktiv og kan ikke kalde nogen. Men den navngiver den
> forkerte leverandør, og fasen må ikke starte uden at rette det.

| ID | Punkt | Hvor | Fase | Ejer |
|---|---|---|---|---|

## 4. Guardrails & sikkerhedshygiejne

| ID | Punkt | Hvor | Note | Ejer |
|---|---|---|---|---|
| **B-25** | **Leaked password protection er slået fra i Supabase Auth.** Vi bruger e-mail + selvvalgt adgangskode (`signInWithPassword`/`signUp`), så HIBP-tjekket er direkte relevant — uden det kan en bruger vælge en adgangskode der allerede står i et kendt læk. | Supabase-dashboardet → Authentication → Policies (ikke kode) | Slå den til. Koden er klar: `translateAuthError` oversætter allerede afvisningen til dansk (ADR 0047), så brugeren ikke møder en engelsk fejl. Gratis, ingen kodeændring, ingen migration. | Mads |
| **B-26** | **De to RLS-hjælpere er stadig eksponeret som RPC.** `has_role` og `is_partner_on_board` bliver bevidst stående eksekverbare — de kaldes af policies og evalueres med kalderens rettigheder (ADR 0047, målt). De lækker intet (begge svarer kun om kalderen selv), men linteren vil blive ved med at rapportere fire advarsler. | `supabase/migrations/0005_competence_tags.sql`, `0011_partner_login.sql` | **Valgfrit.** Vil vi have rapporten helt ren: flyt dem til et ikke-eksponeret skema med `alter function ... set schema` (bevarer OID, så eksisterende policies overlever) og kvalificér dem i alle migrationer. Kræver sin egen skive med fuld db-testkørsel — ikke noget der hænges på en linter-advarsel. | Mads |
| **B-11** | **To secret-scanning-indstillinger kan ikke slås til via API.** `secret_scanning_non_provider_patterns` og `secret_scanning_validity_checks` står som `disabled`; en `PATCH` på repo-endpointet accepteres uden fejl, men flagene skifter ikke. Sandsynligvis GitHub Advanced Security-funktioner, ikke tilgængelige på denne plan. | GitHub repo-indstillinger | Prøv via UI'et (Settings → Code security). Lykkes det ikke, er punktet ikke løsbart uden GHAS — luk det da som "ikke tilgængelig" frem for at lade det stå åbent. Basis-scanning + push protection **er** slået til. | Mads |
| **B-68** | **Sletning af en katalogpost opdaterer ikke boardets Cal.com-hosts og kan efterlade et board under to partnere.** `board_partner.partner_id` har `on delete cascade` (0010): slettes en `partner_profile`-række, forsvinder partneren fra alle sine boards uden at `change_board_composition` (0026, ADR 0064) kaldes — så hverken invarianterne (2-3 partnere, mindst én intern, lead) eller `hosts` hos Cal.com holdes. Der findes ingen sletteaction i appen, så det kan kun ske via databasen eller den kommende GDPR-sletning. | `supabase/migrations/0010_board_matching.sql` (cascade), kommende sletteaction (`docs/gdpr/sletteflow.md`) | Når sletningen bygges: lad den gå gennem sammensætningsfunktionen (eller afvis sletning af en partner der sidder på et board, indtil boardet er rettet), kør `syncHostsForPartner` bagefter og log i `board_change`. Overvej `on delete restrict` på `board_partner.partner_id`. | Claude Code |

## 5. Udviklingsmiljø

| ID | Punkt | Hvor | Note | Ejer |
|---|---|---|---|---|
| **B-13** | **Docker er ikke installeret lokalt** (hverken i bash eller PowerShell). Integration- og db-testene — inkl. de **obligatoriske negative RLS-tests** — kan derfor ikke køres på maskinen, kun i CI. | lokal maskine | Installér Docker Desktop, **eller** accepter bevidst at CI er eneste db-gate og skriv det ned i `tests/CLAUDE.md`. Det er den eneste gate for autorisationslaget. | Mads |

## Lukkede punkter

> ID'er genbruges ikke. Rækken slettes ved lukning, men punktet noteres her, så et hul
> i nummerrækken kan slås op.

| ID | Punkt | Lukket | Hvor det endte |
|---|---|---|---|
| B-01 | GDPR-registret navngav Stripe + Anthropic | 2026-08-26 | Rettet i fase 3-PR'en (#25): Alunta, Ordbogen ×2, ny **kort-gateway**-række (uvalgt), MobilePay omskrevet jf. ADR 0032 |
| B-02 | Fase 2 leveret, men ikke lukket | 2026-08-26 | Betinget lukket — `docs/fase-2-rapport.md`, DoD i `docs/fase-2.md`, liveverifikations-checkliste i `docs/spikes/multi-host.md` |
| B-03 | `.env.example` navngav afløste leverandører | 2026-08-26 | Lukket af #25 (`ALUNTA_*`; ingen `STRIPE_*` tilbage) |
| B-04 | `accounts-to-create.md` forældet | 2026-08-26 | Lukket af #25 (Alunta-række med plan-/webhook-opsætning) |
| B-05 | `src/features/` var tom, mens ADR 0002 foreskrev den | 2026-08-26 | ADR 0035 dokumenterer den faktiske `src/server/<domæne>/`-struktur; mappen er slettet |
| B-06 | `supabase/policies/` refereret tre steder uden at findes | 2026-08-26 | Rettet i `ci.yml`, `docs/projektstruktur.md`, `auto-tests`-skillen |
| B-08 | Payments-adapteren var Stripe-formet | 2026-08-26 | Lukket af #25: `AluntaPaymentProvider` mod verificeret OpenAPI-spec (ADR 0032) |
| B-10 | `.gitignore` dækkede ikke `.env.production`/`.env.staging` | 2026-08-26 | Nu `.env` + `.env.*` med `!.env.example` |
| B-09 | LLM-/transskriptions-adapterne navngav forkert leverandør | 2026-09-15 | `.env.example` retter Anthropic → Ordbogen/OdinCore. DPA-forudsætningen bortfaldt (ADR 0024-opdatering); konto bestilt. Portene forbliver bevidst leverandørneutrale (ADR 0004) |
| B-15 | Fase 2 aldrig kodegennemgået | 2026-08-26 | Gennemgået ved lukning: tre fejl fundet og rettet — `docs/fase-2-rapport.md` §4 + ADR 0029 |
| B-19 | Betalingsmodellen var ændret (ADR 0034), men koden opkrævede pr. afholdt møde | 2026-10-10 | Koden følger nu modellen — migration `0020`, periodekæde, planlagt kørsel, abonnements-adapter og `/betaling` pr. periode: **ADR 0056**. Rest: Alunta-kadencen (B-35) |
| B-18 | Vitest 2.1.9 havde en `critical` Dependabot-alarm | 2026-08-26 | Opgraderet til 3.2.7 + projekter flyttet til `test.projects` — ADR 0033 |
| B-23 | Cal.com-adapteren sendte felter der ikke findes (`hosts`, `attendees:[{id}]`) | 2026-10-10 | Reworket til ét collective event type pr. board: migration 0019 (`board.calcom_event_type_id`, `partner_profile.calcom_user_id`), port/adapter (`upsertBoardEventType`, ét `attendee`-objekt), `/admin/boards` + Cal.com-sæde på partnersiden — ADR 0046 (Implementering). Liveverifikation står stadig åben: L-1, L-3, L-10 |
| B-29 | `datetime-local` blev fortolket i serverens tidszone (UTC på Netlify) ved booking/flytning/initiering | 2026-10-10 | `src/server/time/copenhagen.ts` (`copenhagenLocalToIso`, to-gennemløbs-forskydning); `meetings/actions.ts` og honorarets periodehjælper bruger den — test over begge sommertidsskift |
| B-16 | `OptionsSection.tsx` var utestet (0 af 10 funktioner), og functions-tærsklen stod på 70 | 2026-10-10 | Tests i `tests/unit/options-section.test.tsx` (render, drag-omordning, `reorderOptions`-payload, fejlhåndtering, token-only). Komponenten viser nu den gemte rækkefølge igen + `form__notice` ved afvist gemning (før: lokal rækkefølge blev stående stille). Functions-tærsklen i `vitest.config.ts` hævet til 75 (målt 93,2 %) |
| B-12 | `.claude/hooks/README.md` og `pre-pr-check`-skillen beskrev hooks som ikke-aktiverede og pre-push som lint-gate | 2026-10-10 | Rettet til den faktiske opsætning: `.claude/settings.json` (ADR 0028) aktiverer de to Claude-hooks; `.husky/pre-push` kører typecheck + unit og wires af `npm install` via `prepare` |
| B-41 | «Fejlet betaling» blev aldrig sendt — `notifyPaymentFailed` havde ingen kalder | 2026-10-10 | Alunta-webhookens `invoice.payment_failed` sender til ejeren for hvert træk der skifter til `fejlet`, via `after()` efter svaret (3-sekunders-fristen holder, en notifikationsfejl gør aldrig webhooken rød). Integrationstest |
| B-45 | AI-resuméet blev genereret ved hver sidevisning og aldrig gemt | 2026-10-10 | Gemt som mødeartefakt: migration `0022` (`meeting_summary`, RLS ejer + admin), baggrundsgenerering `generatePendingSummaries` + `/api/cron/summaries` + Netlify scheduled function `summaries` (hvert 15. min), `/moeder/[id]` læser den gemte række: **ADR 0059**. Rest: Cal.com-optagelse (L-8) gør at rigtige møder endnu ender som `mangler_optagelse` (samtykket er kontraktens, ADR 0065) |
| B-40 | Aflysning/flytning direkte i Cal.com gav ingen besked | 2026-10-10 | Cal.com-webhooken sender nu samme besked som app-handlingerne. Idempotensnøglen er gjort tilstandsbaseret (`meetingChangeDiscriminator`: aflyst = fast, flyttet = nyt tidspunkt), så appens handling og Cal.coms ekko af den er én besked. Liveverifikation kræver Cal.com-konto |
| B-21 | Signerede engangslinks til rating var ikke bygget | 2026-10-11 | `rating_link` (migration 0023) + `/vurdering/[token]`: HMAC over rækken, engangsbrug afgjort atomisk i databasen (`redeem_rating_link`), ingen orakel, kun POST indløser — ADR 0060. Levetid er TODO(ejer); `RATING_LINK_SECRET` skal sættes i Netlify |
| B-65 | Indsigtsudtrækket dækkede ikke `board_change` (og heller ikke `meeting_summary`, `rating_link`, `notification_delivery`) | 2026-10-11 | Udtrækket har nu `board_aendringer_udfoert` (aktør-id, uanset rolle), `ejer.boards[].aendringer` (alle ændringer af ejerens boards; andre aktørers id udleveres ikke, kun rolle), `partner.board_aendringer_om_dig`, `…moeder[].resume`, `beskeder_sendt_til_dig` og `vurderingslinks`; afgrænsningen er opdateret — **ADR 0064**, tests i `admin-subject-access` (integration) og `subject-access` (unit) |
| B-66 | Sammensætningsændringer var ikke én transaktion (`applyPlan` skrev i trin; samtidige redaktører kunne overskrive hinanden) | 2026-10-11 | Migration `0026`: `change_board_composition` (`security invoker`, revoked fra klientrollerne) — rækkelås, optimistisk medlemstjek (`40001`), invarianterne som sidste værn og revisionsrækken i samme transaktion; TypeScript afviser stadig invarianterne først. Cal.com-synk forbliver uden for (pessimistisk `calcom_sync`, rettes bagefter) — **ADR 0064**, db-tests i `board-composition-fn.test.ts` |
| B-67 | Ændres en partners Cal.com-sæde, blev boardets hosts ikke opdateret | 2026-10-11 | `setPartnerCalcomUserId` kører `syncHostsForPartner` for hvert board partneren sidder på (kun ved faktisk sædeskift; fejl → advarsel, aldrig rollback; logges som `opdater_hosts`) — **ADR 0064**. Rest (sletning af en katalogpost): B-68 |
| B-20 | Vite 8 og `@vitejs/plugin-react` 6 udestod, og `overrides` i `package.json` skulle ryddes op | 2026-10-11 | Vite `^8.3.4` + plugin-react `^6.1.2`; hele `overrides`-blokken fjernet (Vite 8 har ikke esbuild i træet); `vitest.config.ts` → `.mts` mod Vites config-loader-advarsel. Tests og dækning uændrede, tærskler urørt — **ADR 0067** |
| B-14 | `npm test` krævede Docker, fordi rod-scriptet kørte alle tre Vitest-projekter inkl. `db` | 2026-10-11 | `npm test` = unit + integration (`vitest run --project unit --project integration`, ingen Postgres nødvendig); `test:db` er uændret og eksplicit; nyt `test:all` = alle tre. CI uændret (kalder `test:coverage`/`test:integration`/`test:db`). Dokumenteret i `tests/CLAUDE.md` og `pre-pr-check`-skillen |
