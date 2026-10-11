# tests/ — testkonventioner for ABaaS

> Læs `CLAUDE.md` (rod) først. Dette dokument styrer **hvordan** tests skrives og
> hvor de hører hjemme. `auto-tests`-skillen følger det.

## Runner og lag

Test-runner er **Vitest** (ADR 0003), opdelt i tre projekter i `vitest.config.mts`
(`test.projects` — workspace-filen udgik med Vitest 3, ADR 0033):

| Lag | Miljø | Path | Hvornår |
|---|---|---|---|
| Unit | jsdom | `tests/unit/` | Hver kodeændring (komponenter, flags, consent, rene funktioner) |
| Integration | node | `tests/integration/` | Adapter-/modul-wiring uden netværk (fx adapter-registry) |
| DB | node | `tests/db/` | Schema- og RLS-ændringer (mod lokal Postgres) |

Kør:
```bash
npm test                     # unit + integration — ingen Docker/Postgres (B-14)
npm run test:unit            # jsdom
npm run test:integration     # node
npm run db:test:up           # docker Postgres + wait-for-db (kræves før test:db)
npm run test:db
npm run test:all             # alle tre projekter, inkl. db (kræver Postgres)
npm run test:coverage        # scoped coverage (src/components, src/server/flags)
```

`npm test` kører bevidst kun unit + integration, så det virker uden Docker. `db`-laget er
eksplicit (`test:db`) og kræver en Postgres på `TEST_DATABASE_URL`; `test:all` kører alle tre.
CI kalder de enkelte scripts (`test:coverage`, `test:integration`, `test:db`), ikke `npm test`.

## Mappe-layout
```
tests/
├── CLAUDE.md            # denne fil
├── setup/
│   ├── unit.ts          # RTL cleanup
│   ├── db-global.ts     # globalSetup: nulstil + migrate + seed
│   ├── auth-shim.sql    # lokal auth.uid() (spejler Supabase)
│   └── seed.sql         # app_authenticated-rolle + seed-data
├── unit/                # *.test.ts(x)
├── integration/         # *.test.ts
├── db/                  # *.test.ts (+ helpers.ts: asUser)
└── scripts/             # wait-for-db.mjs m.fl.
```

## Kortlægning: kilde → test

| Kilde | Test-lag | Eksempel |
|---|---|---|
| `src/components/**` | unit (token-only) | `tests/unit/components.test.tsx` |
| `src/server/flags`, `src/server/consent` | unit | `tests/unit/flags.test.ts`, `consent.test.ts` |
| `src/components/**`, sider (tilgængelighed) | unit (axe-core, jsdom) | `tests/unit/a11y.test.tsx` — nye skærme tilføjes dér (ADR 0070); kontrast regnes på tokens i `contrast.test.ts` |
| `src/server/security/**`, `src/proxy.ts` (headere, CSP) | unit + integration | `tests/unit/security-headers.test.ts`, `tests/integration/proxy-csp.test.ts` |
| `src/lib/<vendor>/**` (adaptere) | integration (registry/wiring) | `tests/integration/adapters.test.ts` |
| `supabase/migrations/**` (incl. RLS-policies) | db (RLS) | `tests/db/rls.test.ts` |

## Konventioner

- **Path-alias:** importér fra `@/...` (→ `src/...`).
- **Komponenter:** test at styling kommer fra token-klasser — **ingen inline-styles**, ingen
  hardcodede farver/fonts/radius/spacing. Brug `@testing-library/react`.
- **Adaptere:** test at factoryen returnerer en **stub** når flag=OFF/nøgle mangler; at
  fire-and-forget-stubs (email/sms/analytics) resolver; at backend-stubs kaster
  `NotConfiguredError`. Importér porte via `@/lib` — aldrig et SDK direkte.
- **RLS (db):** kør som rollen `app_authenticated` via `asUser(sub, ...)` i `tests/db/helpers.ts`.
  **Negative policy-tests er obligatoriske** (fx at en partner uden for et board, eller en
  fremmed ejer, ser 0 rækker) — ikke valgfrie. Nye RLS-tabeller kræver både positive og
  negative cases.
- **Dansk** i `describe/it`-beskrivelser hvor koden er dansk-tung.
- **Genbrug mønstre:** læs en eksisterende test i samme lag før du skriver en ny; indfør ikke
  nye runnere, mock-biblioteker eller mønstre uden en ADR.
- Slet aldrig eksisterende tests for at få en suite grøn.
