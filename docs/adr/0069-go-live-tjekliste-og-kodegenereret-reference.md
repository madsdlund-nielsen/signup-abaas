# 0069 — Go-live-tjekliste og kodegenereret reference: én datafil, to læsere, ingen CI-gate endnu

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 6 (6.4 flag- og stub-gennemgang, 6.5 dokumentation, 6.6 overlevering)
- **Berører uafklaret punkt:** nej. Tjeklisten *viser* de åbne ejer-/Mads-punkter; den afgør ingen af dem. Hvem der accepterer en stub eller parkerer en beslutning er ikke noget kode kan gøre — datafilen har felterne, men står tom.

## Kontekst

Fase 6 kræver at hvert flag er bevidst tændt eller slukket, at stub-registret er tomt eller
accepteret punkt for punkt, at `FLAG_DEMO` er slået fra, at ADR-indekset er hul-frit, at der
findes genereret reference (ruter, skema) og en runbook. Det er en liste Mads skal kunne aflæse
uden at åbne ti filer, både på den kørende platform (hvad er rigtigt, hvad er demo?) og i repoet
(hvor mange TODO'er, stub-rækker og backlog-punkter?). Tre valg skulle træffes.

## Overvejede muligheder

1. **Hvor tjeklistens statiske viden bor** (hvilke nøgler en port kræver, hvilke beslutninger er åbne):
   - Hårdkodet i komponenten. Forkastet — en beslutning lukkes så ved at redigere præsentation.
   - Læst ud af markdown (`CLAUDE.md`, stub-registret). Forkastet — prosa er ikke et kontraktformat.
   - **En ren datafil, `src/server/admin/launch-data.json`.** Valgt: begge læsere importerer den,
     en beslutning lukkes ved at slette dens post (som backloggen), og en parkering/accept står
     som `{ by, date }` — uden dem er punktet åbent.
2. **Hvordan kommandolinjen får samme viden som skærmen.** Skærmen spørger adapter-factorierne
   (ADR 0053); `npm run launch:check` kan ikke importere TypeScript med stialiasser.
   - Importere TS fra .mjs via typestripping. Forkastet — skrøbeligt (aliaser, JSON-import-attributter, Node-version).
   - **Spejle den lille miljøregel i `scripts/lib/launch-core.mjs` og bevogte den med en paritetstest**
     (`tests/integration/launch-parity.test.ts`): samme tilstand som factorierne for otte miljøer,
     `realAdapterBuilt`/`demoAdapterBuilt` afprøvet mod de rigtige factorier, og hver nøgle i
     datafilen skal stå i `.env.example`. Valgt — dobbeltarbejdet er ~40 linjer, og testen fejler
     i det øjeblik en factory læser en ny nøgle eller en rigtig adapter bygges.
3. **Referencedokumentationen:** generér fra koden med egne små parsere (`scripts/lib/reference-core.mjs`),
   eller tag et værktøj ind. Ingen af de kendte værktøjer læser `create policy`, Next-ruter og
   `.env.example` ét sted; en afhængighed for 800 linjer tekstparsing er dyrere end parserne.
   Valgt: egne parsere, med tre regler — udled, tæl det du ikke forstår, gæt aldrig.

## Beslutning

- **`/admin/klar`** (`src/server/admin/readiness.ts`, ren `buildReadiness`) og
  **`npm run launch:check`** (`scripts/launch-check.mjs`, exit 1 når noget blokerer, `--report`
  skriver markdown, `--skip-env` kun repoet) viser: `FLAG_DEMO`, pr. port rigtig/demo/stub, krævede
  hemmeligheder (kun «sat/mangler/for kort» — aldrig værdi eller længde), aktive regler (prisregel,
  honorarregel, live skabeloner pr. type og kanal), øvrige flag mod deres dokumenterede hensigt,
  adgangsporten, og åbne beslutninger. CLI'en tæller desuden TODO-markører i `src/` og `supabase/`,
  stub-registerets rækker, åbne backlog-punkter og ADR-indeksets huller (et nummer markeret
  «nummer reserveret» er et dokumenteret tomrum).
- **En stub er en blokering, indtil nogen har sagt ja.** `accepted: { by, date }` i datafilen er
  mekanismen; den er `null` overalt. En port uden rigtig adapter i koden (video, bogføring,
  analytics-skrivning) er derfor en blokering, ikke et grønt felt.
- **«Ukendt er ikke klar».** Kan reglerne ikke læses (ingen Supabase, forespørgselsfejl), tæller
  det som en blokering, ikke som nul.
- **Referencen** (`npm run docs:reference` → `docs/reference/{routes,schema,env}.md`): ruter og handlers
  med metode og adgang udledt af guards i filen eller i et overliggende layout (usikre markeret
  «usikker» — «ingen guard fundet» er ikke «offentlig»); skemaet parset fra migrationerne i filrækkefølge
  (RLS pr. tabel, policies foldet gennem `drop policy`, ikke-genkendte sætninger talt nederst);
  miljøvariabler fra `.env.example` med launch-krav fra datafilen. Ingen tidsstempler, så output er deterministisk.
- **Ingen CI-gate for referencen nu.** `npm run docs:reference -- --check` findes (exit 1 ved afvigelse),
  men er ikke koblet på `ci.yml`: flere PR'er ad gangen ville hver blive røde for en genereret fil de
  ikke selv rørte, og hver ny migration eller rute ville tvinge en regenerering midt i review. Kobles på,
  når skiver ikke længere lander parallelt — eller som rådgivende trin.
- **Designvalg:** paletten har ingen rød (jf. `.form__notice`), så «blokerer» er et navyfyldt statusmærke
  (`status-badge--blocked`) og «klar» den guldfyldte live-tone; ordet bærer betydningen, farven forstærker.
- **Tooling:** typedeklarationer til `.mjs`-kernerne bor i `*.d.mts`; ESLint ignorerer dem (Next-reglernes
  JS-parser kan ikke læse TypeScript), `tsc` er deres kontrol.

## Konsekvenser

- Positive: Mads kan på ét minut se hvad der skiller os fra launch, både live og fra terminalen; fase 6.4's
  flag- og stub-gennemgang er en kommando; reference og runbook kan ikke løbe fra koden uden at det kan måles.
- Negative / pris: miljøreglen findes to steder (bevogtet af paritetstesten); datafilen skal vedligeholdes —
  glemmer nogen at slette en lukket beslutning, bliver tjeklisten rød, hvilket er den sikre fejlretning;
  referencen kan blive forældet mellem kørsler indtil CI-gaten kobles på.
- Opfølgning: når en rigtig video-, bogførings- eller analytics-adapter bygges, sættes `realAdapterBuilt` i
  datafilen (paritetstesten fejler indtil da). Når ejeren accepterer en stub eller en beslutning parkeres,
  noteres det i `launch-data.json` med navn og dato. `CLAUDE.md` bør opdateres til systemet som det blev
  (fase 6.5) — ikke gjort her.
