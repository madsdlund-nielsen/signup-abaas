# 0005 — Feature-flag-systemets design

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A). Bruges bl.a. til at mørklægge det uafklarede in-app-messaging-modul.

## Kontekst

CLAUDE.md kræver feature-flags fra fase 0, så uafklarede/senere moduler kan skjules
uden redeploy (fx in-app messaging, der er helt uafklaret).

## Overvejede muligheder

- DB-backed flags pr. tenant/board — fleksibelt, men for tungt til fase 0 uden et
  Supabase-projekt.
- Env-baserede flags — simpelt, kontofrit, nok til at gate moduler nu.

## Beslutning

Et minimalt, env-baseret flag-system i `src/server/flags`: en typet `FeatureFlag`-union
og `isEnabled(flag, env)` der læser `FLAG_<NAVN>`. Alle integrationsflag er OFF som
standard. `inAppMessaging` returnerer altid `false` (mørklagt uanset env) indtil ejer
beslutter modulet. Adapter-factoryene konsulterer flagene, så en sub-processor først
aktiveres når både flag og nøgle er på plads.

## Konsekvenser

- Positive: moduler kan slås til/fra uden redeploy; ingen infrastruktur kræves nu.
- Negative/pris: ingen per-bruger/-tenant-targeting endnu.
- Opfølgning: et DB-backed lag (pr. tenant/board) kan lægges ovenpå i en senere ADR
  uden at ændre kaldssitet.
