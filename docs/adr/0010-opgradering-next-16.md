# 0010 — Opgradering til Next.js 16 + ESLint flat config

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A — tooling)

## Kontekst

Udkastet blev startet på Next.js 15.5. Nyeste major er nu **Next.js 16 (16.2.9, GA)**;
React 19 er allerede nyeste major (19.2.x). Da fladen er minimal (én side, få deps) og
launch først er oktober 2026, opgraderes der nu frem for at bygge fase 1 på en afløst major.

## Overvejede muligheder

- **Bliv på Next 15** — stabilt, men starter ét major bagud.
- **Opgradér til Next 16 nu** — billigt mens fladen er lille; følger den aktuelle major.

## Beslutning

Next.js 16. Konsekvens for lint: Next 16 fjerner `next lint` og kører ikke længere ESLint
i `next build`. Vi migrerer til **ESLint 9 flat config** (`eslint.config.mjs`) der spreder
`eslint-config-next/core-web-vitals` (native flat config i v16); `.eslintrc.json` fjernes og
`lint`-scriptet er `eslint src`. Next 16 satte automatisk `tsconfig.json` `jsx` til
`react-jsx` (React automatic runtime). React/react-dom forbliver 19; Node forbliver 22.
Dette erstatter den `next lint`-baserede del af ADR 0009 — CI-jobbet er uændret (samme
`npm run lint`).

## Konsekvenser

- Positive: aktuel major fra start; native flat config; mindre tooling-gæld.
- Negative/pris: ESLint flat config er nyere terræn end `.eslintrc`; lint scoper til `src`.
- Opfølgning: ingen.
