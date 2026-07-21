# 0012 — Hosting: Netlify

- **Status:** Accepteret
- **Dato:** 2026-07-21
- **Fase:** 0
- **Berører uafklaret punkt:** punkt 24 + 26 (Henosia vs. Netlify; SSR+cron) — nu afklaret af Mads.

## Kontekst

Fase 0 kræver et deploybart skelet, men hosting var en åben 🟡 SPIKE (`docs/spikes/hosting.md`).
Krav: EU-serverplacering (GDPR fra fase 0), SSR til Next.js App Router, og cron/scheduled jobs
til senere påmindelser/honorar-jobs. Valget var udskudt til account-adgang og Mads' beslutning;
ADR 0009 udelod bevidst CD indtil host var valgt, og ADR 0008 udskød host-secret-storen hertil.

## Overvejede muligheder

- **Netlify (IE)** — førsteklasses Next.js-runtime (`@netlify/plugin-nextjs`), Git-baseret deploy,
  scheduled functions til cron, EU-region for funktioner tilgængelig. Irsk selskab.
- **Henosia (DK)** — dansk placering, men mindre moden Next.js-SSR-/cron-historik; mere
  opsætnings- og driftsarbejde for samme funktionalitet.

## Beslutning

**Netlify.** Bygget med `@netlify/plugin-nextjs` (SSR + App Router), Node 22 (matcher `.nvmrc`),
deploy via Netlifys Git-integration (ikke GitHub Actions). Se `netlify.toml`.

**EU-residens:** Netlifys funktioner kører som standard i US East (Ohio, `cmh`). Next.js-funktioner
genereres på build-tid, så pr.-funktion `region` i `netlify.toml` gælder ikke — funktions-regionen
sættes **projekt-bredt i Netlify-UI'et** (Build & deploy > Functions region → EU (Ireland) `dub`).
🔴 TODO(mads): sæt Functions region = EU (Ireland) og bekræft her; region-valg kræver ≥ Pro-plan.

**Secret-store:** runtime-env-variabler sættes i **Netlify > Environment variables** (ikke
GitHub-secrets). Dette lukker den udskudte host-secret-store i ADR 0008.

## Konsekvenser

- Positive: SSR + cron løst med lav opsætning; Git-deploy uden separat CD-job; EU-region muligt.
- Negative / pris: EU-funktions-region kræver Pro-plan og et manuelt UI-valg (ikke i kode) — let
  at glemme; derfor eksplicit TODO + verifikations-note i leverandør-registret. Irsk (ikke DK)
  dataplacering, men inden for EU.
- Opfølgning:
  - 🔴 TODO(mads): Functions region = EU (Ireland) i Netlify-UI + bekræft.
  - Netlify-DPA underskrives før produktion (ejer/jura) — se `docs/gdpr/leverandoer-register.md`.
  - CI'ens deploy-job forbliver udeladt; deploy sker via Netlifys Git-integration (ADR 0009).
