# 0008 — Secrets-/env-struktur

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** delvist — host-specifik secret-store afhænger af hosting-spiken (Trin 3, Mads).

## Kontekst

Ingen secrets i repo. Vi skal forberede env for 9 sub-processorer uden at have nøgler
endnu, og uden at have valgt hosting (hvor prod-secrets skal ligge).

## Overvejede muligheder

- Vente med env-struktur til hosting er valgt — blokerer adapter-arbejdet unødigt.
- Etablere en host-neutral `.env.example` nu; host-specifik store senere.

## Beslutning

Én `.env.example` med alle variabler som dokumenterede placeholdere, grupperet pr.
vendor, plus feature-flag-variabler og `TEST_DATABASE_URL` til lokale db-tests.
`.gitignore` dækker `.env*`. Adapterne læser env gennem typet `readConfig` og falder
tilbage til stub når en nøgle mangler. Host-specifik secret-store (CI/deploy) fastlægges
når hosting er valgt.

## Konsekvenser

- Positive: integration kan forberedes kontofrit; nøgler "fyldes ind" uden kodeændring.
- Negative/pris: den endelige secret-mekanik (hvordan prod henter secrets) er udeladt
  indtil hosting-valg.
- Opfølgning: 🔴 host-specifik secrets-store + CI-secrets afventer hosting-spiken (Trin 3).
