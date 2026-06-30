# 0003 — Test-runner og teststruktur: Vitest

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A — test-runner og teststruktur)

## Kontekst

CLAUDE.md kræver fuld test-suite i CI (unit, integration, DB-lag, type check).
CI/CD-flowet kopieres fra qlim8-app, som bruger Jest. ABaaS er en Next.js/Vite-app;
test-runneren skal vælges (Spand A).

## Overvejede muligheder

- **Jest** (som qlim8) — velkendt, men kræver babel/ts-jest-konfiguration og
  ESM-workarounds i et Vite/Next-miljø.
- **Vitest** — deler transform-pipeline med Vite, native ESM + TS, hurtig,
  projekt-opdeling via workspace.

## Beslutning

Vitest, med tre projekter i `vitest.workspace.ts`: `unit` (jsdom + React Testing
Library), `integration` (node) og `db` (node, `globalSetup` mod Postgres). Bevidst
afvigelse fra qlim8's Jest: vi kopierer qlim8's CI-**struktur** (job-form,
Postgres-service, gate-tankegang), men kører Vitest under, fordi det passer bedre til
Vite/Next og giver mindre konfigurationsgæld. Mads bekræftede valget.

## Konsekvenser

- Positive: minimal konfiguration; hurtige tests; samme tre-lags-opdeling som qlim8
  (unit/integration/db).
- Negative/pris: afviger fra qlim8 → de to repos deler ikke test-runner-viden 1:1.
- Opfølgning: ingen.
