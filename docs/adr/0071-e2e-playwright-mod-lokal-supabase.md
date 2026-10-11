# 0071 — Ende-til-ende-verifikation: Playwright mod en lokal Supabase-stak

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 6 (arbejdspakke 6.1)
- **Supplerer:** ADR 0003 (Vitest), ADR 0041/0043 (demo + demo-seed), ADR 0015 (migrationsflow)
- **Berører uafklaret punkt:** nej (Spand A — teststruktur og migrations-/miljøflow)

## Kontekst

Fase 6.1 kræver at hele rejsen er verificeret ende-til-ende, og at gælden fra fase 1 indfries
("kun auth-flowet er verificeret i produktion — resten lokalt og i CI"). Vitest-lagene (unit,
integration, db) tester lagene hver for sig; db-laget kører mod en **almindelig Postgres 16 med en
auth-shim** (`tests/setup/auth-shim.sql`), ikke mod Supabase. Intet i suiten har kørt migrationerne
mod rigtig Supabase (auth-skema, rolle-grants, PostgREST-skemacache, GoTrue), og ingen test har
åbnet en browser.

## Beslutning

1. **Playwright** (`@playwright/test`, pinnet til `1.56.1` fordi det er den version hvis Chromium
   er forhåndsinstalleret i vores miljø) som e2e-runner. Egen suite i `tests/e2e/`, eget script
   `npm run test:e2e` — **ikke** i `npm test` og ikke i Vitest (`vitest.config.mts` matcher kun
   `*.test.ts`; e2e-filerne hedder `*.spec.ts`).
2. **Appen køres som `next build && next start`**, ikke `next dev`: det er den artefakt vi
   leverer, og `next dev` omskriver `CLAUDE.md`.
3. **Databasen er Supabase CLI'ens lokale stak** (Docker): Postgres 17, GoTrue, PostgREST, Kong og
   Mailpit; studio, storage, realtime, edge runtime og analytics er slået fra. Nøglerne genereres
   af CLI'en ved hver start og læses af `supabase status` — **ingen nøgle ligger i repoet**.
4. **Stakkens `config.toml` ligger i `tests/e2e/supabase/`, ikke i `supabase/`**, med
   `supabase start --workdir tests/e2e`. `migrations/` dér er et symlink til `supabase/migrations`,
   så e2e kører præcis de filer produktion får. Begrundelse: Supabases GitHub-integration læser
   `supabase/` (ADR 0015), og en `config.toml` dér kan blive anvendt som projektkonfiguration. Vores
   lokale værdier (`site_url = localhost:3100`, mailbekræftelse tvunget til, rate-limits sat til
   1000, services slået fra) må aldrig kunne ramme produktion.
5. **Demo-adaptere** (`FLAG_DEMO=true`, ADR 0041) i stedet for leverandører. Alle leverandørvariabler
   og `DATABASE_URL` blankes eksplicit for app-processen, så en rigtig nøgle (fra shell eller
   `.env.local`) aldrig kan vinde over demo. `FLAG_LEADPARTNER=true` så lead-rollen kan gennemspilles.
   Webhook-hemmelighederne sættes til kendte, åbenlyst falske værdier, så testen kan signere som
   leverandøren — de aktiverer ingen adapter.
6. **Opsætning (`global-setup`)**: tjek at stakken er loopback; `supabase db reset` (alle
   migrationer på en tom database — det er selv en verifikation); vent på PostgREST; opret
   bekræftede testbrugere via admin-API'et; kør `scripts/seed-demo.mjs` med `DEMO_OWNER_EMAIL`
   (ADR 0043) for en ejer med befolket tilstand. Ejeren der gennemspiller rejsen signer op i
   browseren. Opsætningen **nægter** at køre mod alt andet end loopback, fordi den nulstiller basen.
7. **Seks specs i filrækkefølge på én worker** (`01-ejer` … `06-webhooks`): de deler én database, og
   senere specs bygger på tilstand fra tidligere (ejerens board → partnerens møder). Selektorer er
   roller og labels, aldrig CSS. RLS verificeres desuden mod den rigtige PostgREST med et rigtigt
   login, ikke kun via UI.
8. **Skærmbilleder** af hver hovedskærm i `tests/e2e/__screens__/` er **gitignorerede** og uploades
   som CI-artefakt. Binære billeder ændrer sig med hvert designtoken og ville støje i hver PR; de
   skal ses af et menneske, ikke diffes.
9. **CI**: `.github/workflows/e2e.yml` kører manuelt (`workflow_dispatch`) og hver nat — **ikke på
   hver PR**. Jobbet henter Supabase-images, bygger appen og kører ~55 browsertests (ca. 10-15 min på
   en GitHub-runner); på hver PR ville det fordoble CI-tid og -omkostning for en suite der er
   langsom og kræver Docker-in-Docker. Det er en bevidst gradvis tilgang: kør det manuelt på PR'er
   der rører rejsen (auth, booking, betaling, honorar, admin), og tag det ind som PR-gate hvis
   natkørslerne viser at det er stabilt.

## Alternativer

- **Hostet Supabase-testprojekt** — realistisk, men nulstilling af en delt base, nøgler i CI og
  produktions-nære persondata. Afvist: en lokal stak er gratis, isoleret og ens for alle.
- **`supabase/config.toml` i repoet** — standardstedet, men se punkt 4.
- **Cypress / Vitest browser mode** — Playwright er allerede forhåndsinstalleret i miljøet og har
  de rigtige roller/labels-selektorer og flere browsere-kontekster i samme test (brugt til at
  tjekke at booking respekterer en partners tilgængelighed på tværs af to brugere).
- **Skærmbilleder i git** — afvist, se punkt 8.

## Konsekvenser

- Positive: migrationerne 0001-0027 er verificeret rene mod rigtig Supabase (Postgres 17); RLS er
  aktiv på alle 30 tabeller med mindst én policy hver; hele rejsen er klikket igennem; webhook-
  idempotens er bevist mod en rigtig database; en ny fejltype (`supabase db reset` før PostgREST er
  klar) er fanget i opsætningen. Fundene er i `docs/backlog.md` (B-70, B-71) eller rettet (se
  `docs/fase-6.md` § 6.1-status).
- Negative/pris: en ny tung afhængighed (Docker + images, nogle GB) og en suite der tager ~2
  minutter oven på build. Specs er koblet via delt tilstand; en ny rejse skal placeres i rækkefølgen.
  Demo-adapterne betyder at **leverandør-adfærd stadig ikke er verificeret** — listen står i
  `docs/e2e.md`.
- Opfølgning: tag e2e ind som PR-gate når natkørslerne er stabile; kør rejsen igen mod en rigtig
  staging når nøglerne lander (live-verifikationen, L-1…L-10).
