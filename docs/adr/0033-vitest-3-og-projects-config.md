# 0033 — Vitest 3: sikkerhedsopgradering og projekter i `test.projects`

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 3 (tværgående)
- **Opdaterer:** ADR 0003 (test-runner og teststruktur)
- **Berører uafklaret punkt:** nej (Spand A — test-runner og teststruktur)

> **Nummerering:** 0030–0032 er reserveret til fase 3-PR'en (#25), som endnu ikke er
> merget. Denne ADR tager derfor 0033 frem for det næste ledige nummer på `main` — så
> undgås præcis den kollision der opstod mellem #25 og #30.

## Kontekst

Dependabot blev slået til i ADR 0028 og rapporterede straks 24 åbne alarmer, hvoraf én
**critical**: Vitest 2.1.9 kan læse og eksekvere vilkårlige filer når **Vitest UI-serveren
lytter**. Første rettede version er **3.2.6** — et major-spring fra 2.1.x.

Den reelle risiko i dette repo er lav: Vitest er en dev-dependency, alarmen kræver at
UI-serveren kører, og der findes intet `--ui`-script. Men:

- Alarmen er `critical` og bliver stående i sikkerhedsoversigten indtil den lukkes.
- Repoet er offentligt, så alarmen er synlig.
- Et major-spring på test-runneren rører ADR 0003 og skal være en beslutning, ikke et
  `npm update` der løber med.

Samtidig markerer Vitest 3 `vitest.workspace.ts` som deprecated: filen fjernes i næste
major. Bliver den stående, udskydes bare det samme arbejde — og hver CI-kørsel logger en
deprecation-advarsel.

## Overvejede muligheder

- **Lade alarmen stå og dokumentere risikoen som accepteret.** Forsvarligt på teknisk
  grundlag, men efterlader en `critical` i et offentligt repo, og prisen ved at opgradere
  viste sig at være nul (se nedenfor).
- **Opgradere til 3.2.6 og beholde workspace-filen.** Lukker alarmen, men efterlader en
  deprecation-advarsel i hver kørsel og det samme migrationsarbejde til næste major.
- **Opgradere til 3.2.7 og flytte projekterne til `test.projects`.** Valgt.

## Beslutning

**Vitest og `@vitest/coverage-v8` opgraderes til `^3.2.7`** (3.2.7 frem for minimum 3.2.6 —
samme major, nyeste patch), og de tre projekter flyttes fra `vitest.workspace.ts` til
`test.projects` i `vitest.config.ts`. Workspace-filen slettes.

**Lagene er uændrede:** `unit` (jsdom + React Testing Library), `integration` (node),
`db` (node + `globalSetup`). Samme navne, samme stier, samme setup-filer — kun *hvor* de
er defineret har flyttet sig. `tests/CLAUDE.md` er rettet tilsvarende, og ADR 0003 er
annoteret frem for omskrevet.

**`@vitejs/plugin-react` opgraderes IKKE.** Nyeste version (6.x) kræver Vite ^8, mens
Vitest 3 kører på Vite 5. Det ville trække en Vite-major med, og det hører ikke til en
sikkerhedsopgradering af test-runneren.

## Konsekvenser

- Positive: den eneste tilbageværende `critical` er lukket. Deprecation-advarslen er væk,
  og migrationen til næste Vitest-major er allerede gjort. **Alle 115 tests bestod uden
  én ændring i en testfil** — hverken API- eller adfærdsændringer ramte suiten.
- Negative/pris: ingen målt. Dækningen er uændret (70,7 % mod tærsklen på 70 %).
- Bemærk: en advarsel om *"The CJS build of Vite's Node API is deprecated"* består. Den
  kommer fra Vite 5's egen Node-API og er uafhængig af denne opgradering; den lukkes
  først når Vite-majoren tages, og det er bevidst ikke gjort her.
- Opfølgning: fase 3-PR'en (#25) er verificeret mod Vitest 3 før merge, så dens 32 ekstra
  tests ikke først falder over på `main`.
