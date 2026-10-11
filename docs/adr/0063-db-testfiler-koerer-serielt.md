# 0063 — DB-testfilerne kører én ad gangen

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** — (testinfrastruktur, ADR 0003/0033)
- **Berører uafklaret punkt:** nej

## Kontekst

Vitest kører testfiler parallelt som standard. `db`-projektet deler én Postgres-database, og
hver test kører i en transaktion der rulles tilbage (`asPostgres`/`asUser`). Det holdt så længe
testfilerne rørte hver sin del af schemaet.

Med demo-seed'et (ADR 0043), der nu også indsætter notifikationsskabeloner (ADR 0057), og
skabelontestene der indsætter de samme `(type_key, channel, version)`-nøgler, deadlockede CI:
to transaktioner ventede på hinandens unikke indeks-tupler (`40P01` på
`notification_template_type_key_channel_version_key`). Lokalt ramte det 1-2 af 3 kørsler før
demo-oprydningens DDL blev fjernet, og CI ramte det igen bagefter — på en commit der kun ændrede
dokumentation.

## Overvejede muligheder

- **A — gør nøglerne disjunkte pr. testfil.** Skrøbeligt: enhver ny seed- eller testfil kan
  genindføre kollisionen, og fejlen er sjælden nok til at slippe igennem en PR.
- **B — advisory locks i de berørte tests.** Løser kun de kendte par og kræver at hver ny test
  husker låsen.
- **C — `fileParallelism: false` for `db`-projektet.** Én fil ad gangen; tests inden for en fil
  kørte i forvejen sekventielt.

## Beslutning

**C.** Db-laget er autorisationslagets gate (RLS, de obligatoriske negative tests); en flaky
gate er værre end en langsom. Unit og integration kører fortsat parallelt.

## Konsekvenser

- Positive: deadlocks på tværs af testfiler er udelukket som klasse, ikke kun for de kendte par.
- Negative: `npm run test:db` tager ~21 s i stedet for ~8 s lokalt (målt, 3 kørsler).
- Opfølgning: ingen.
