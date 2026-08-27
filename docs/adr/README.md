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
| 0017 | Quiz-datamodel + admin-UI-tilgang (dependency-fri) | Accepteret | 1 |
| 0018 | Ejer-skrivbar RLS + quiz-svar-datamodel | Accepteret | 1 |
| 0019 | Partner-katalog: datamodel + scope | Accepteret | 1 |
| 0020 | Adgangsport: delt adgangskode før auth | Accepteret | 1 |
| 0021 | Board-medlemskab peger på partner-kataloget, ikke auth-brugere | Accepteret | 1 |
| 0022 | Board-matching: grådig set-cover med deterministisk tie-break | Accepteret | 1 |
| 0023 | Betaling ind: Alunta (erstatter Stripe Billing) | Accepteret | 2 |
| 0024 | Transskription og LLM: Ordbogen (ordbogen.ai + chat.dk/Odin) | Accepteret | 2 |
| 0025 | Partner-login: identitetskobling + admin-initieret invitation | Accepteret | 2 |
| 0026 | Møde-datamodel: livscyklus og partner-registrering er to felter | Accepteret | 2 |
| 0027 | Webhook-ingest: signatur før alt, idempotens via event-tabel | Accepteret | 2 |
| 0028 | Guardrails: lag-grænser som lint-regel og gates der faktisk kører | Accepteret | 2 |
| 0029 | Webhook-idempotens skal betyde "præcis én gang" (præciserer 0027) | Accepteret | 2 |
| 0030 | Betalings-datamodel: versionerede prisregler + charge pr. afholdt møde | Accepteret | 3 |
| 0031 | Alunta-tilgangen: omdøbt config og webhook-skelet, ingen gættet adapter | Accepteret | 3 |
| 0032 | Alunta-dataflow verificeret: usage-abonnement med øre-parameter | Accepteret | 3 |
| 0033 | Vitest 3: sikkerhedsopgradering og projekter i `test.projects` | Accepteret | 3 |
| 0034 | Betalingsmodel: fast abonnement hver 4. uge, gateway = QuickPay | Accepteret | 3 |
| 0035 | Projektstruktur: domænemapper under `src/server/` (erstatter 0002's opdeling) | Accepteret | 3 |
| 0036 | Transitive sikkerhedsopdateringer via `overrides` frem for major-opgraderinger | Accepteret | 3 |
| 0037 | Supabase- og Netlify-MCP: læseadgang ja, skriveadgang nej | Accepteret | 3 |
| 0038 | Forberedelse og rating: datamodel og synlighedsregimer | Accepteret | 4 |
| 0039 | Mærkesystemet i UI'et + site-chrome (header, fod, forside) | Accepteret | — |

> Note: `docs/fase-0-eksekvering.md` omtaler "ADR 0001 (hosting)", "0002 (auth)" osv.
> — det er illustrative numre. Faktisk nummerering følger "næste ledige nummer", så
> 0001 er byggespec. Spike-ADR'erne (hosting, auth, multi-host, GDPR) tager de næste
> ledige numre (0010+) når spikene afsluttes efter account-adgang.
