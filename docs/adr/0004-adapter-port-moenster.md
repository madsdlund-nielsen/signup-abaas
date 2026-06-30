# 0004 — Adapter-/port-mønster for sub-processorer

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (arkitekturprincip 2). Flere konkrete leverandørvalg er dog 🔴 flagget i `docs/fase-0-rapport.md`.

## Kontekst

Arkitekturprincip 2: eksterne systemer afkobles bag adaptere, så de kan udskiftes
uden at røre domænet. Vi skal forberede integration med 9 sub-processorer UDEN at
have accounts/nøgler endnu (ejerne opretter accounts; adgang gives næste uge).

## Overvejede muligheder

- SDK-kald direkte i domænet — hurtigst nu, men binder os til leverandører og bryder
  princip 2.
- Tynd port pr. vendor + stub indtil nøgler lander.

## Beslutning

Hver sub-processor får `src/lib/<vendor>/` med `port.ts` (domænevendt interface) og
`index.ts` (typet env-config + stub + en factory der flag-gater valget). Uden
flag/nøgle returnerer factoryen en stub: fire-and-forget-porte (email/sms/analytics)
logger og resolver; backend-porte (payments/booking/video/accounting/llm/transcription)
kaster `NotConfiguredError`. Domæne/features importerer KUN porte via `src/lib/index.ts`.
Den rigtige adapter udfyldes bag den uændrede port når accounts/nøgler lander.

> Bemærk: udkastet nævnte fire filer pr. vendor; vi samlede config+stub+factory i
> `index.ts` ved siden af `port.ts` — samme mønster, mindre boilerplate, og plads til
> en sibling-fil for den rigtige adapter senere.

## Konsekvenser

- Positive: leverandører er udskiftelige; appen kører/bygger/testes uden nøgler; hver
  integration kan "fyldes ind" isoleret når nøgler lander.
- Negative/pris: et ekstra indirektionslag; portene skal vedligeholdes når domænet vokser.
- Opfølgning: leverandørvalg (e-conomic/Dinero, transskription, Alunta, LLM-EU) og
  Cal.com multi-host-spike er 🔴 flagget i fase-0-rapporten.
