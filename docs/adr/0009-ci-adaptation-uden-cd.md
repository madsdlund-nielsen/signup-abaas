# 0009 — CI-adaptation fra qlim8 (CI uden CD)

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** ja — hosting (Henosia vs. Netlify) er en åben spike (Trin 3, Mads); deploy må ikke besluttes.

## Kontekst

CI/CD-flowet skal kopieres/tilpasses fra qlim8-app. qlim8's pipeline indeholder et
deploy-job til Hetzner. ABaaS-hosting er en uafgjort 🟡 SPIKE — Claude Code må ikke
vælge host eller wire en deploy.

## Overvejede muligheder

- Kopiér hele qlim8-pipen inkl. deploy — ville binde os til en host (forbudt).
- Kopiér kun CI (lint/type/test/build); lad CD afvente hosting-valget.

## Beslutning

`.github/workflows/ci.yml` med jobs: `lint`, `typecheck`, `build` (`next build`),
`unit-tests` og `integration-db-tests` (Postgres 16-service; db-projektets `globalSetup`
anvender migrations + policies). Node 22 (match qlim8 + lokal udvikling). Deploy-jobbet
er bevidst UDELADT og markeret med en kommentar; `synthetic-prod-health` udelades (ingen
prod endnu). Når Mads har valgt host, tilføjes deploy + host-secrets + en hosting-ADR.

## Konsekvenser

- Positive: rød CI blokerer merge fra første commit; ingen host-binding foregribes.
- Negative/pris: ingen automatisk deploy endnu; branch protection skal slås til i
  GitHub-settings (kan ikke committes til repoet).
- Opfølgning: 🔴 deploy/CD + branch protection + hosting-ADR afventer hosting-spiken (Trin 3).
