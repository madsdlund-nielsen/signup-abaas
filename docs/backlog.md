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

## 2. Drift der kræver en beslutning

| ID | Punkt | Hvor | Handling | Ejer |
|---|---|---|---|---|
| **B-07** | **Tie-break-punktet har ingen ejer.** Byggespec §5.2 flager det og henviser til §12 — men punktet findes ikke i §12's tabel (numrene 3, 20 og 23 mangler). Det står heller ikke i `CLAUDE.md`'s liste over uafklarede punkter. | `src/server/matching/algorithm.ts:47`, `docs/fase-1-rapport.md` §3 | Tilføj punktet til `CLAUDE.md`'s ejer-liste (eller få §12 rettet), så det ikke falder mellem to stole. Koden holder en neutral, deterministisk pladsholder — registreret i stub-registret. | Ejer |

## 3. Leverandør-drift i kode (venter på sin fase)

> Ikke hastende: koden er stub-aktiv og kan ikke kalde nogen. Men den navngiver den
> forkerte leverandør, og fasen må ikke starte uden at rette det.

| ID | Punkt | Hvor | Fase | Ejer |
|---|---|---|---|---|
| **B-21** | **Signerede engangslinks til rating er ikke bygget.** Fase 4.2's DoD nævner dem (byggespec §8); ADR 0038 udskød dem bevidst, fordi et engangslink er en auth-fri skrivevej der først kan gennemspilles end-to-end når der findes en notifikationsmotor til at udsende den. Vurdering kræver login indtil videre — det opfylder "ingen åbne endpoints", men ikke "besvares på under et minut" fra en mail. | `src/server/ratings/actions.ts` (`TODO(mads)`) | **4.5** — bygges sammen med notifikationsmotoren. Blokeret på Resend-konto. | Mads |
| **B-23** | **Cal.com-adapteren sender felter der ikke findes.** ADR 0046 lukkede spikens L-2: `POST /bookings` har **intet `hosts`-felt** (værter hører til event typen), og `attendee` er **ét objekt** med `{name, email, timeZone}` — ikke et bruger-id. Adapteren sender `attendees: [{id}]` + `hosts: [...]` med Supabase-auth-UUID'er. Multi-host skal bygges som **ét collective event type pr. board**. | `src/lib/booking/calcom.ts` (`createMultiHostMeeting`), `src/lib/booking/port.ts` (`MultiHostMeetingRequest`), `src/server/meetings/actions.ts` (`readBoardBookingInfo`), `CALCOM_EVENT_TYPE_ID` → kolonne på `board` (migration), partner ↔ Cal.com-bruger-id | **Før booking går live.** Ikke hastende for MVP: `FLAG_BOOKING` er slået fra og der er ingen nøgler — modulet kan ikke booke nogen. | Mads |
| **B-19** | **Betalingsmodellen er ændret, men koden er ikke.** ADR 0034 fastslår et **fast abonnement der forfalder hver 4. uge**; fase 3 opkræver pr. **afholdt møde** (usage). Prisformlen overlever — kun triggeren er forkert. | `supabase/migrations/0013_payment.sql` (`payment_charge.meeting_id unique`), `src/server/charges/create.ts`, `src/server/meetings/actions.ts` (afholdelses-flippet), `src/lib/payments/alunta.ts` (`reportUsageCharge`), `src/app/betaling/page.tsx` | **Skal ske før betaling går live.** Ikke hastende for MVP: `FLAG_PAYMENTS` er slået fra, ingen prisregel findes, og der er ingen Alunta-nøgler — modulet kan ikke opkræve nogen. Alunta-planen skal oprettes som abonnement med 4-ugers interval, ikke usage-plan. | Mads |

## 4. Guardrails & sikkerhedshygiejne

| ID | Punkt | Hvor | Note | Ejer |
|---|---|---|---|---|
| **B-11** | **To secret-scanning-indstillinger kan ikke slås til via API.** `secret_scanning_non_provider_patterns` og `secret_scanning_validity_checks` står som `disabled`; en `PATCH` på repo-endpointet accepteres uden fejl, men flagene skifter ikke. Sandsynligvis GitHub Advanced Security-funktioner, ikke tilgængelige på denne plan. | GitHub repo-indstillinger | Prøv via UI'et (Settings → Code security). Lykkes det ikke, er punktet ikke løsbart uden GHAS — luk det da som "ikke tilgængelig" frem for at lade det stå åbent. Basis-scanning + push protection **er** slået til. | Mads |
| **B-12** | **Dokumentationen af de lokale gates skal efterses, nu hvor hookene er aktiveret** (ADR 0028 tilføjede `.claude/settings.json`). `.claude/hooks/README.md` beskriver stadig aktivering som noget der mangler at ske, og `pre-pr-check`-skillen beskriver husky-gaten som kørende uden at nævne at den wires af `npm install`. | `.claude/hooks/README.md`, `.claude/skills/pre-pr-check/SKILL.md` | Ret begge tekster så de beskriver den faktiske opsætning. | Mads |
| **B-16** | **`OptionsSection.tsx` er stadig utestet.** Halvt lukket i ADR 0040: `PartnerCard.tsx` og `PageHeader.tsx` har fået tests, `supabase-server.ts` er udeladt af dækningsfladen, og tærsklerne er hævet til 75/75/70/70. Tilbage står `OptionsSection.tsx` (181 linjer) på **0 af 10 funktioner** — det største hul i fladen, og grunden til at functions-tærsklen blev stående på 70 frem for at følge de øvrige op. | `src/components/OptionsSection.tsx`, `vitest.config.ts` | Skriv tests og hæv derefter functions-tærsklen. Komponenten er drag-omordning med async `persistOrder`, så den kræver mere end en render-test. Ikke hastende: marginen er 4,72 points. | Mads |
| **B-20** | **Vite 8 og `@vitejs/plugin-react` 6 udestår, og `overrides` i `package.json` skal ryddes op når de tages.** Vitest-delen er lukket: PR #43 sprang direkte til Vitest 5, og dækningsskiftet er håndteret i ADR 0040. Vite er låst til `^6.4.3` via `overrides` (ADR 0036), hvilket Vitest 5 accepterer (`^6.4.0 \|\| ^7 \|\| ^8`), så intet haster. | `package.json` (`overrides`), `vitest.config.ts` | Advarslen i denne række holdt: AST-remappingen tippede functions og branches, præcis som forudsagt. Den er nu indfriet og behøver ikke gentages. Tilbage er kun Vite-majoren og oprydningen. | Mads |

## 5. Udviklingsmiljø

| ID | Punkt | Hvor | Note | Ejer |
|---|---|---|---|---|
| **B-13** | **Docker er ikke installeret lokalt** (hverken i bash eller PowerShell). Integration- og db-testene — inkl. de **obligatoriske negative RLS-tests** — kan derfor ikke køres på maskinen, kun i CI. | lokal maskine | Installér Docker Desktop, **eller** accepter bevidst at CI er eneste db-gate og skriv det ned i `tests/CLAUDE.md`. Det er den eneste gate for autorisationslaget. | Mads |
| **B-14** | **`npm test` kræver Docker.** Rod-scriptet kører alle tre Vitest-projekter, inkl. `db`, så det fejler bare uden Docker. | `package.json` | Overvej at lade `npm test` dække unit + integration og holde `test:db` eksplicit. | Mads |

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
| B-18 | Vitest 2.1.9 havde en `critical` Dependabot-alarm | 2026-08-26 | Opgraderet til 3.2.7 + projekter flyttet til `test.projects` — ADR 0033 |
