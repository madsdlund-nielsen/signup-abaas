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
| Arkitektur-/leverandørvalg | `docs/adr/` | ADR-on-decision, obligatorisk |

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
| **B-01** | **GDPR-leverandørregistret peger på afløste databehandlere.** Registret lister stadig Stripe (betaling ind) og "Anthropic Claude / EU-LLM". ADR 0023 valgte **Alunta**, ADR 0024 valgte **Ordbogen** til både LLM og transskription. | `docs/gdpr/leverandoer-register.md:15,18` | `CLAUDE.md` gør registret til **autoritet for hvilke DPA'er der mangler**. Listen over manglende DPA'er er derfor p.t. forkert — og DPA-status er et SKAL-krav før produktionsbrug. | Mads |
| **B-03** | **`.env.example` navngiver afløste leverandører.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MOBILEPAY_MERCHANT_ID`; "LLM (Anthropic Claude API eller EU-hostet)"; "Transskription (dansk/EU-udbyder uafklaret)". | `.env.example` | Det er filen alle kopierer til `.env.local`. ⚠ `MOBILEPAY_MERCHANT_ID` må ikke bare omdøbes: MobilePay **gennem Alunta** er stadig uverificeret (`CLAUDE.md`, afventer Mads). | Mads |
| **B-04** | **`accounts-to-create.md` er forældet.** Afsnit B siger stadig "Stripe + MobilePay … Alunta-alternativ åbent" og "Anthropic Claude API (el. EU-LLM)". | `docs/accounts-to-create.md` | Det er den praktiske tjekliste for hvilke konti ejerne skal oprette — den sender dem til de forkerte leverandører. | Mads |

## 2. Drift der kræver en beslutning

| ID | Punkt | Hvor | Handling | Ejer |
|---|---|---|---|---|
| **B-05** | **`src/features/` er tom.** ADR 0002 låste en feature-baseret struktur (`features/{onboarding,board,booking,…}`), men al domænekode er endt i `src/server/<domæne>/`. Strukturen er altså skiftet ved drift, ikke ved beslutning. | `src/features/` (kun `README.md`), `docs/adr/0002-*.md`, `docs/projektstruktur.md` | Vælg: (a) ny ADR der **erstatter** 0002 og beskriver den faktiske `server/`-baserede struktur, eller (b) migrér koden. Lad ikke driften stå. `src/features/README.md` beskriver desuden en struktur der ikke findes — og nævner Stripe. | Mads |
| **B-07** | **Tie-break-punktet har ingen ejer.** Byggespec §5.2 flager det og henviser til §12 — men punktet findes ikke i §12's tabel (numrene 3, 20 og 23 mangler). Det står heller ikke i `CLAUDE.md`'s liste over uafklarede punkter. | `src/server/matching/algorithm.ts:47`, `docs/fase-1-rapport.md` §3 | Tilføj punktet til `CLAUDE.md`'s ejer-liste (eller få §12 rettet), så det ikke falder mellem to stole. Koden holder en neutral, deterministisk pladsholder — registreret i stub-registret. | Ejer |

## 3. Leverandør-drift i kode (venter på sin fase)

> Ikke hastende: koden er stub-aktiv og kan ikke kalde nogen. Men den navngiver den
> forkerte leverandør, og fasen må ikke starte uden at rette det.

| ID | Punkt | Hvor | Fase | Ejer |
|---|---|---|---|---|
| **B-08** | **Payments-adapteren er stadig Stripe-formet:** læser `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`MOBILEPAY_MERCHANT_ID` og kaster `NotConfiguredError("stripe", …)`. ADR 0023 valgte Alunta. | `src/lib/payments/index.ts`, `port.ts` | 3 | Mads |
| **B-09** | **LLM- og transskriptions-adapterne er generiske** (`LLM_API_KEY`, `TRANSCRIPTION_API_KEY`). ADR 0024 udpeger Ordbogen (ordbogen.ai + chat.dk/Odin). DPA er stadig forudsætning — se stub-registret. | `src/lib/llm/index.ts`, `src/lib/transcription/index.ts` | 4 | Mads |

## 4. Guardrails & sikkerhedshygiejne

| ID | Punkt | Hvor | Note | Ejer |
|---|---|---|---|---|
| **B-10** | **`.gitignore` dækker ikke `.env.production` / `.env.staging`.** Kun `.env` og `.env*.local` er dækket. | `.gitignore` | GitHub push protection fanger kendte nøgleformater — ikke en `DATABASE_URL` med password i. Én linje at rette. | Mads |
| **B-11** | **To gratis secret-scanning-indstillinger er slået fra:** `secret_scanning_non_provider_patterns` og `secret_scanning_validity_checks` (basis-scanning + push protection **er** slået til). | GitHub repo-indstillinger | Non-provider patterns fanger bl.a. generiske connection strings og private nøgler — netop det push protection ellers misser. | Mads |
| **B-12** | **Dokumentationen af de lokale gates skal efterses, nu hvor hookene er aktiveret** (ADR 0028 tilføjede `.claude/settings.json`). `.claude/hooks/README.md` beskriver stadig aktivering som noget der mangler at ske, og `pre-pr-check`-skillen beskriver husky-gaten som kørende uden at nævne at den wires af `npm install`. | `.claude/hooks/README.md`, `.claude/skills/pre-pr-check/SKILL.md` | Ret begge tekster så de beskriver den faktiske opsætning. | Mads |
| **B-16** | **Dækningsmarginen er tynd.** Tærsklen er 70 % og den målte dækning er 70,7 % (ADR 0028) — næste utestede komponent kan tippe CI rød. `PartnerCard.tsx` (68 linjer) og `OptionsSection.tsx` (181 linjer) står begge på 0 %. | `vitest.config.ts`, `src/components/PartnerCard.tsx`, `src/components/OptionsSection.tsx` | Skriv tests for de to komponenter og hæv derefter tærsklen — hellere end at sænke den ved næste rødt. `OptionsSection` er drag-omordning og kræver mere end en render-test. | Mads |
| **B-17** | **Merge-økonomi-reglen kan løsnes, når build-skippet er verificeret.** `netlify.toml` springer nu builds over for diffs der kun rører docs/tests/CI-config (ADR 0028), men reglen "saml en hel fase i ÉN PR" står uændret i `CLAUDE.md`. | `netlify.toml` (`TODO(mads)`), `CLAUDE.md` § Arbejdsform pkt. 5 | Bekræft på den første docs-only merge at Netlify rapporterer "Build skipped" og ikke trækker kredit. Derefter: beslut om reglen kan blive til "én PR pr. arbejdspakke", så review og `git bisect` bliver brugbare igen. **Ikke Claude Codes beslutning** — det er en stående ordre fra Mads. | Mads |

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
| B-02 | Fase 2 leveret, men ikke lukket | 2026-08-26 | Betinget lukket — `docs/fase-2-rapport.md`, DoD i `docs/fase-2.md`, liveverifikations-checkliste i `docs/spikes/multi-host.md` |
| B-06 | `supabase/policies/` refereret tre steder uden at findes | 2026-08-26 | Rettet i `ci.yml`, `docs/projektstruktur.md`, `auto-tests`-skillen |
| B-15 | Fase 2 aldrig kodegennemgået | 2026-08-26 | Gennemgået ved lukning: tre fejl fundet og rettet — `docs/fase-2-rapport.md` §4 + ADR 0029 |
