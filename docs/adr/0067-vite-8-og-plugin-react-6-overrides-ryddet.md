# 0067 — Vite 8 og `@vitejs/plugin-react` 6; `overrides` ryddet (lukker B-20)

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** — (værktøjskæde, ADR 0033/0036/0040)
- **Supplerer:** ADR 0036 (Vite 6 via `overrides`) og ADR 0040 (Vitest 5)
- **Berører uafklaret punkt:** nej (Spand A — teststruktur/værktøjskæde)

## Kontekst

ADR 0036 låste `vite` til `^6.4.3` og `esbuild` til `^0.25.0` via `overrides` i
`package.json`, fordi sårbarhederne var rettet dér, og fordi Vitest 3 ikke accepterede
Vite 8. Det var bevidst en midlertidig løsning: «`overrides` er usynligt i afhængighedslisten
og kan maskere en fremtidig inkompatibilitet. De skal ryddes op når værktøjskæden alligevel
opgraderes.» Siden er Vitest kommet på 5 (ADR 0040), som accepterer `vite ^6.4.0 || ^7 || ^8`.
Det eneste der holdt Vite på 6 var overrides'ene og `@vitejs/plugin-react` 4 (B-20).

## Beslutning

1. **`vite` `^8.3.4`** som eksplicit devDependency (før kun en peer, der kom med via
   Vitest) og **`@vitejs/plugin-react` `^6.1.2`** (peer: `vite ^8`).
2. **Hele `overrides`-blokken fjernes.** Begge poster er overflødige:
   - `vite` — Vite 8 er over den rettede 6.4.3.
   - `esbuild` — Vite 8 bygger på Rolldown/Oxc og har ikke længere esbuild i sit træ; `esbuild`
     findes slet ikke i `node_modules` efter opgraderingen. Der er altså ingen sårbarhed at
     holde nede.
   Ingen override beholdes: efter fjernelsen rapporterer `npm audit` ingen vite-/esbuild-fund.
3. **`vitest.config.ts` omdøbes til `vitest.config.mts`.** Vite 8 advarer ved hver
   projekt-opstart (`configLoader: 'native'` bliver standard i en kommende major) om at
   en ESM-config ligger i en fil der indlæses som CommonJS — pakken har ikke
   `"type": "module"`. `.mts` er den mindst invasive rettelse; `"type": "module"` på
   pakken ville ændre indlæsningen af alle øvrige `.js`/`.ts`-konfigurationsfiler (Next, ESLint,
   scripts). `tsconfig.json` får `vitest.config.mts` i `include`, så filen stadig typetjekkes
   (`**/*.ts` rammer ikke `.mts`).

Vitest-konfigurationen er i øvrigt uændret: ingen ændring i projekter, aliaser, `react()`-pluginet
eller dækningsindstillingerne.

## Verifikation

Fuld gate før og efter, samme database og samme tests:

| | Vite 6 / plugin-react 4 | Vite 8 / plugin-react 6 |
|---|---|---|
| unit | 651 | 651 |
| integration | 397 | 397 |
| db | 357 | 357 |
| dækning (statements / branches / functions / lines) | 94,43 / 86,70 / 94,03 / 95,85 | 94,43 / 86,70 / 94,03 / 95,85 |

Dækningstallene er identiske til to decimaler (V8-dækningen måles af Vitest, ikke af Vite), så
**tærsklerne i `vitest.config.mts` er uændrede** (75 / 70 / 75 / 75, ADR 0040).

## Konsekvenser

- Positive: ingen skjulte `overrides`; ét færre sted hvor værktøjskæden afviger fra det
  deklarerede; esbuild (og dermed dets sårbarhedsflade) er helt ude af træet.
- Negative/pris: Vite 8 er ny (Rolldown); en regression i jsdom-/React-transformen ville
  vise sig som testfejl, ikke som runtime-fejl, da Vite kun bruges af Vitest — Next bygger med
  sin egen toolchain.
- Opfølgning: ingen. B-20 er lukket.
