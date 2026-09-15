# 0043 — Demo-seed: befolket tilstand hægtet på en eksisterende ejer

- **Status:** Accepteret
- **Dato:** 2026-09-15
- **Fase:** løbende (demo-tilstand, ADR 0041)
- **Berører uafklaret punkt:** grænser til *startpris/meeting-fee* — se "Prisreglen" nedenfor. Beslutningen om prisen træffes ikke; en åbenlyst falsk 1-kr-regel gør skærmen klikbar.

## Kontekst

Med ADR 0041 kan ejerrejsen klikkes igennem, men hver gennemklikning starter fra nul: quiz,
board, kort, booking, afholdelse, vurdering. For at designe på *efter*-skærmene (afholdt møde,
opkrævninger, vurderinger) skulle man gennemspille alt hver gang. Demo-seed'et gav hidtil kun
quiz + katalog, og runbook'en sagde udtrykkeligt: ingen prisregler.

Begrænsning: seed'et kan ikke oprette auth-brugere (Supabase Auth), og en `app_user`-række uden
auth-bruger kan ikke logge ind.

## Overvejede muligheder

- **Opret en demo-ejer i `auth.users` via SQL.** Skrøbeligt (Supabase-interne kolonner) og
  umuligt i den lokale test-Postgres, som ikke har auth-schemaet.
- **Hægt tilstanden på en eksisterende ejer** (e-mail som parameter). Ét manuelt trin (signup),
  men virker ens lokalt, i test og mod Supabase. **Valgt.**
- **Hægt på ejerens eksisterende board.** Ville mutere rigtige data (membership er unik pr.
  board). Afvist: seed'et nægter, hvis ejeren allerede har et board.

## Beslutning

1. `DEMO_OWNER_EMAIL=<mail> npm run db:seed:demo`. Scriptet sætter `demo.owner_email` på
   sessionen (`set_config`), og `demo.sql` læser den i en `do $$ … $$`-blok. Uden variablen er
   adfærden uændret. Ukendt e-mail eller en ejer med board → **exception**, ingen delvis
   tilstand.
2. Faste uuid'er i `d0000000-…`-serien og `on conflict` overalt → idempotent. Mødetidspunkter er
   relative til `now()` og opdateres ved gentagne kørsler, så det kommende møde bliver ved med
   at være kommende.
3. Demo-kort og demo-links følger ADR 0041's mønstre: `DEMO-CUSTOMER-<id>`,
   `DEMO-BOOKING-SEED-…`, `/moeder/rum/<uid>`.
4. **Prisreglen.** Én regel på 1,00 kr + 1,00 kr pr. partner (faktor 1,0 → 4,00 kr for tre
   partnere) indsættes KUN sammen med en ejer og KUN hvis ingen aktiv regel findes. Findes en,
   røres intet, og ingen opkrævning seedes. 1 kr kan ingen forveksle med en beslutning
   (ADR 0041's data-regel); reglen fjernes af demo-clean. Rigtige satser er stadig
   ejer-territorium og tastes af admin i `/admin/priser`.
5. `demo-clean.sql` sletter i rækkefølgen board (cascader alt) → prisregel → quiz/katalog, fordi
   `payment_charge → pricing_rule` ikke cascader. Har rigtige møder nået at få opkrævninger på
   demo-reglen, fejler sletningen højlydt frem for at efterlade forældreløse rækker.

## Konsekvenser

- Positive: én kommando → et board med historik. Efter-skærmene kan designes uden gennemspil.
  Db-testene dækker den befolkede tilstand, guarden, afvisningerne og RLS (positiv + negativ).
  Første gang db-testene er kørt lokalt i repoet — containeren har Postgres 16.
- Negative/pris: ét manuelt trin (signup) før seed. Runbook'ens "ingen prisregler" bliver til
  "en 1-kr demo-regel, guarded". Den eksisterende db-test er omdøbt, ikke slettet.
- Opfølgning: `FLAG_DEMO=true` på sua-abaas udestår stadig (Mads — Netlify-UI'et, eller
  allow-reglen i backlog B-22).
