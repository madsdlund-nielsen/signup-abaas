# Byggespec — menneske-spec (reference)

Denne mappe indeholder den fulde, menneske-skrevne byggespec for ABaaS som
**baggrundsreference**. Den styrer ikke Claude Code's adfærd — det gør
`CLAUDE.md` i repo-roden. **Ved konflikt vinder `CLAUDE.md`.**

## Seneste version

`ABaaS_Byggespec_v5.pdf` (juni 2026)

## Sådan lægges en opdatering ind

Ejeren opdaterer specen løbende. Når der kommer en ny version:

1. Læg den ind som en **ny fil** med stigende versionsnummer —
   `ABaaS_Byggespec_v6.pdf`, `_v7.pdf`, … Slet ikke tidligere versioner; de
   bliver liggende, så ændringshistorik er læsbar for mennesker (git versionerer
   også binæren, men eksplicitte versionsfiler gør spring mellem versioner
   synlige uden at skulle diffe binært).
2. Opdatér **"Seneste version"** ovenfor.
3. Tilføj en linje i **changeloggen** nedenfor med kort hvad der ændrede sig.
4. Hvis den nye version afklarer eller flytter et af de **uafklarede punkter** i
   `CLAUDE.md` (pris, honorar, leverandør, dataresidens, jura osv.), så opdatér
   `CLAUDE.md` i **samme PR** — og skriv en ADR i `docs/adr/` hvis det er et
   arkitektur-, stack-, leverandør-, datamodel- eller domænegrænse-valg.

Selve mappens placering og versioneringskonventionen er besluttet i
`docs/adr/0001-byggespec-placering-og-versionering.md`.

## Changelog

| Version | Dato | Note |
|---|---|---|
| v5 | 2026-06 | Første version lagt i repo (`docs/byggespec/`). |
