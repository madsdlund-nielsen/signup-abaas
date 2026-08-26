# 0036 — Transitive sikkerhedsopdateringer via `overrides` frem for major-opgraderinger

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 3 (tværgående)
- **Supplerer:** ADR 0033 (Vitest 3)
- **Berører uafklaret punkt:** nej (Spand A — teststruktur/værktøjskæde)

## Kontekst

Efter Vitest 3-opgraderingen (ADR 0033) stod fire Dependabot-alarmer tilbage, alle med
**development**-scope: `vite` (1 high + 2 medium), `esbuild` (medium) og `brace-expansion`
(high). Ingen af dem rammer produktions-bundlen.

Dependabot foreslog dem samlet i PR #34: **vite 5.4.21 → 8.2.2, vitest 3 → 4,
`@vitejs/plugin-react` 4 → 6**. Tre koordinerede majors, fordi Dependabot opgraderer hele
ancestor-kæden frem for at finde den mindste rettede version.

PR #34's CI fejlede — men ikke på tests: **alle 123 tests bestod.** Den fejlede på
dækningstærsklen, fordi Vitest 4 skiftede v8-dækningens regnemetode til AST-baseret
remapping. Funktionsdækningen faldt fra 81,0 % til 69,2 % (tærskel 70) og branch fra
87,3 % til 71,1 % på præcis den samme kode og de samme tests. Ikke en regression — en ny
målemetode.

Nøgleobservationen: **alarmerne er rettet i `vite@6.4.3`, ikke først i 8.x**, og
`vitest@3.2.7` accepterer allerede `vite ^5 || ^6 || ^7`.

## Overvejede muligheder

- **Tag PR #34 som den er.** Lukker alarmerne, men koster tre majors på værktøjskæden fire
  dage før en MVP-aflevering, plus arbejde med at genvinde dækningstærsklen under Vitest 4's
  nye målemetode. Prisen står ikke mål med dev-scope-alarmer der reelt ikke kan udnyttes her:
  `vite`-hullet er et `server.fs.deny`-bypass i **Vites dev-server**, og projektet bruger
  Next.js til udvikling — Vite kører kun inde i Vitest.
- **Lade alarmerne stå.** Afvist: et offentligt repo med åbne high-alarmer, og prisen for at
  lukke dem viste sig at være to linjer.
- **Tvinge de rettede transitive versioner med `overrides`.** Valgt.

## Beslutning

`package.json` får et `overrides`-felt:

```json
"overrides": { "vite": "^6.4.3", "esbuild": "^0.25.0" }
```

Det løfter `vite` 5.4.21 → 6.4.3 og `esbuild` 0.21.5 → 0.25.12 **uden** at røre `vitest`
(3.2.7) eller `@vitejs/plugin-react` (4.7.0). `brace-expansion` rettes transitivt med på
købet. `npm audit`: **0 vulnerabilities**.

**Konventionen fremover:** når Dependabot foreslår en major-kæde for at lukke en alarm i en
*transitiv* afhængighed, så find først den mindste rettede version og tving den med
`overrides`. Major-opgraderinger af værktøjskæden er selvstændige beslutninger med egen ADR
— ikke noget der kommer med som bivirkning af en sikkerhedsrettelse.

⚠ **`overrides` er et skarpt værktøj.** Et forsøg på også at tvinge
`brace-expansion: ^2.1.2` brød dækningskørslen: `minimatch` (via `test-exclude` i
coverage-provideren) bruger v1-API'et, og v2 har en anden eksport. Fejlen viste sig som
`TypeError: (0 , brace_expansion_1.expand) is not a function`. **Et override gælder hele
træet** — verificér altid med en fuld gate-kørsel, ikke kun `npm audit`.

## Konsekvenser

- Positive: alle Dependabot-alarmer lukket (0 åbne). Værktøjskæden er urørt, så dækningen
  står uændret på sin egen målemetode (75,2 % / 88,9 % / 86,2 %). Ingen risiko fire dage
  før MVP-aflevering.
- Negative/pris: `overrides` er usynligt i `package.json`'s afhængighedsliste og kan maskere
  en fremtidig inkompatibilitet. De skal ryddes op når værktøjskæden alligevel opgraderes.
- Opfølgning: **Vitest 4 + Vite 8 + plugin-react 6 er stadig den rigtige destination**, bare
  ikke nu. Sporet som `docs/backlog.md` **B-20**, inkl. at Vitest 4's nye dækningsmåling
  kræver enten flere tests eller en revideret tærskel. ADR 0033's bemærkning om at
  "Vitest 3 kører på Vite 5" er hermed opdateret til Vite 6.
