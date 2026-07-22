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
| 0001 | Byggespec: placering og versionering | Accepteret | 0 |
| 0002 | Projektstruktur: feature-baseret + lib/server-grænse + komponenttilgang | Accepteret | 0 |
| 0003 | Test-runner og teststruktur: Vitest | Accepteret | 0 |
| 0004 | Adapter-/port-mønster for sub-processorer | Accepteret | 0 |
| 0005 | Feature-flag-systemets design | Accepteret | 0 |
| 0006 | Migrationsflow og database-navnekonventioner | Accepteret | 0 |
| 0007 | RLS-policy-mønster og kontofri test | Accepteret | 0 |
| 0008 | Secrets-/env-struktur | Accepteret | 0 |
| 0009 | CI-adaptation fra qlim8 (CI uden CD) | Accepteret | 0 |
| 0010 | Opgradering til Next.js 16 + ESLint flat config | Accepteret | 0 |
| 0011 | GDPR-arkitektur (Trin 10) | Accepteret | 0 |
| 0012 | Hosting: Netlify | Accepteret | 0 |
| 0013 | Auth: Supabase Auth | Accepteret | 0 |
| 0014 | Auth-flow-mønster (login/signup/guard) | Accepteret | 1 |
| 0015 | Migrationer til produktion (Supabase CLI) | Accepteret | 1 |
| 0016 | Business-data-access-mønster + admin-fundament + has_role | Accepteret | 1 |

> Note: `docs/fase-0-eksekvering.md` omtaler "ADR 0001 (hosting)", "0002 (auth)" osv.
> — det er illustrative numre. Faktisk nummerering følger "næste ledige nummer", så
> 0001 er byggespec. Spike-ADR'erne (hosting, auth, multi-host, GDPR) tager de næste
> ledige numre (0010+) når spikene afsluttes efter account-adgang.
