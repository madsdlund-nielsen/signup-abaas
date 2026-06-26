# Architecture Decision Records (ADR)

Denne mappe fanger **hvorfor** koden ser ud som den gør — synkront med at
beslutningerne træffes, ikke rekonstrueret bagud i fase 6.

## Hvornår skrives en ADR?

Skriv en ADR når du træffer et valg der er svært/dyrt at omgøre senere, fx:

- Et stack- eller leverandørvalg (hosting, auth, betalingslag, transskription).
- Et resultat af en spike (fase 0: multi-host, hosting, auth).
- En datamodel- eller domænegrænse-beslutning (fx hvordan board, møder, honorar
  relaterer sig).
- En afvejning der berører et uafklaret punkt fra `CLAUDE.md`.

Trivielle implementeringsdetaljer kræver ikke en ADR. Tommelfingerregel: hvis en
ny udvikler (eller en fremtidig Claude Code-session) ville spørge "hvorfor blev
det gjort sådan?", så skriv en ADR.

## Sådan gør du

1. Kopiér `0000-template.md` til `NNNN-kort-titel.md` med næste ledige nummer.
2. Udfyld den. Hold den kort — en halv side er nok.
3. Sæt status til `Accepteret` når valget står fast.
4. Tilføj linjen i indekset nedenfor.
5. Erstat aldrig en gammel ADR — lav en ny der erstatter den, og sæt den gamle
   til `Erstattet af NNNN`.

## Indeks

| # | Titel | Status | Fase |
|---|---|---|---|
| 0000 | Skabelon (ikke en rigtig ADR) | — | — |
