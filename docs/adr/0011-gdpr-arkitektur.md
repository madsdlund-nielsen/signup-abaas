# 0011 — GDPR-arkitektur (Trin 10)

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** delvist — DPA-underskrifter, samtykketekst/ToS og opbevaringsjura er ejer-/jura-afhængige (🔴 flag).

## Kontekst

GDPR skal bygges ind fra fase 0 (arkitekturprincip 3), ikke tilføjes bagefter. Trin 10 kræver:
EU-residens kortlagt pr. leverandør, DPA-struktur, sletteflow skitseret og en samtykke-hook —
alt sammen kontofrit (ingen accounts/nøgler endnu).

## Overvejede muligheder

- **Vent til leverandører/accounts er på plads** — ville udskyde GDPR til efter integration,
  i strid med princip 3.
- **Etablér arkitektur + register nu; underskrifter/tekst senere** — kortlæg data, region og
  DPA-status pr. leverandør, definér samtykke-model og sletteflow som hooks, og flag det
  jura-/ejer-afhængige.

## Beslutning

Vi etablerer GDPR-arkitekturen kontofrit:
- **Leverandør-register** (`docs/gdpr/leverandoer-register.md`): leverandør → datatype →
  region → EU-residens → DPA-status → flag, for alle sub-processorer + Supabase + hosting.
- **Sletteflow** (`docs/gdpr/sletteflow.md`): Supabase som udgangspunkt (FK `on delete
  cascade`) + udfan til eksterne via en fremtidig `eraseDataSubject`-portmetode pr. adapter.
- **Samtykke-model** (`src/server/consent`): typet, opt-in (kun "nødvendig" som standard;
  `functional`/`analytics` kræver aktivt valg). Banner-UI og tekst flagges til ejer/ToS.

DPA-underskrifter, samtykketekst og opbevaringsjura besluttes ikke her — de er flagget i
registret og fase-0-rapporten.

## Konsekvenser

- Positive: GDPR er indbygget fra start; registret er kilden til "hvilke DPA'er mangler";
  samtykke og sletning har klare hooks som adaptere/UI kan bygge på.
- Negative/pris: registret skal vedligeholdes når accounts oprettes og DPA'er underskrives;
  `eraseDataSubject`-metoderne implementeres først når adapterne udfyldes.
- Opfølgning: 🔴 DPA-underskrifter pr. leverandør (ejer); samtykketekst + ToS (ejer);
  opbevaringsperioder for bogføring/betaling (ejer/jura).
