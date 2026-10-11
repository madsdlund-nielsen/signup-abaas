# 0066 — PostHog-driftstatus: separat læse-port og en personal API key med læse-scope

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 5 (5.4 admin-dashboard)
- **Berører uafklaret punkt:** nej. Det eneste der mangler er en nøgle (Mads) — ingen forretnings-, pris- eller juraafgørelse.

## Kontekst

`/admin/drift` skulle vise driftsstatus fra PostHog (fase 5.4), men analytics-porten er en
fire-and-forget skrive-port uden query-grænseflade (ADR 0004, 0053). Tre valg:

1. Hvor læsningen bor: udvide `Analytics`-porten eller en ny port.
2. Hvilken legitimation: ingest-nøglen (`POSTHOG_KEY`) kan ikke læse; PostHogs Query API kræver en
   personal API key med "Query Read".
3. Hvad en læsefejl må gøre ved driftssiden.

## Overvejede muligheder

- **Udvid `Analytics` med en `query()`.** Blander to modsatte kontrakter: skrivning må aldrig
  fejle højlydt (fire-and-forget), læsning skal. Stubben logger i dag og resolver — en læse-stub
  der resolver ville returnere tomme tal, præcis det stub-politikken forbyder.
- **Direkte `fetch` fra siden.** Bryder arkitekturprincip 2.
- **Ny læse-port `src/lib/ops-metrics/` med stub, demo og PostHog-adapter.** Valgt.

## Beslutning

- **Ny port** `src/lib/ops-metrics/` (`OpsMetricsProvider.getOpsMetrics({ since, activeSince })`),
  registreret som `adapters.opsMetrics`. Returnerer kun aggregater: hændelser og undtagelser
  siden `since` (24 timer), højst tre fejltyper, og antal unikke aktive personer siden `activeSince`
  (7 dage). Aldrig rækker eller person-id'er.
- **Adapter** mod `POST {host}/api/projects/{project_id}/query/` med `Authorization: Bearer
  <personal API key>` og en `HogQLQuery`, rå `fetch` med 8 s timeout. Fejl er danske
  `ProviderError`s (status, aldrig svarindhold). Fejltype læses fra `$exception_types` /
  `$exception_type` og filtreres til en positiv tegnliste; `$exception_values` (beskeden) hentes
  aldrig, fordi den kan indeholde persondata.
- **Env, alle server-only:** `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, valgfri
  `POSTHOG_API_HOST` (default `https://eu.posthog.com`). Ingen `NEXT_PUBLIC_`. Flag: det eksisterende
  `FLAG_ANALYTICS`. Nøglen skal oprettes med kun læse-scope (`query:read`) — se
  `docs/accounts-to-create.md`. Hosten skal være https (undtagen localhost).
- **Tilstande (ADR 0041):** rigtig når flag + begge nøgler er sat; demo (`FLAG_DEMO`) kun når
  nøglerne mangler — tal er 1 og fejltypen er `[DEMO] DemoFejl`; ellers stub, der kaster
  `NotConfiguredError`.
- **Siden:** `getPostHogOps()` i `src/server/admin/` kaster aldrig. Den giver `ok` / `not_configured`
  ("Ikke koblet på") / `unreadable` ("Kunne ikke læses"), så en fejl hos PostHog aldrig vælter
  `/admin/drift`, og siden viser aldrig nuller i stedet for en fejl. Kaldet sker efter admin-tjekket
  i `/admin/layout.tsx`.
- **Ikke verificeret live** (`TODO(mads): verificér live` i `posthog.ts`): at `person_id`, `countIf`/
  `uniqIf` og `toDateTime(…, 'UTC')` accepteres i vores projekts HogQL, og om SDK'et sender
  `$exception_types` eller `$exception_type`. Adapteren dækker begge property-navne.

## Konsekvenser

- Positive: driftssiden kan vise rigtige tal så snart Mads har oprettet en nøgle; skrive- og
  læsesiden kan udskiftes hver for sig; ingen persondata forlader eller lagres.
- Negative/pris: en port mere; to nøgler til samme leverandør (ingest og læsning) med forskellig
  sensitivitet. En personal API key er knyttet til en bruger og skal roteres hvis personen forlader
  teamet. Personal API keys har et timebudget (429 vises som "læsebudget opbrugt").
- Opfølgning: live-verifikation af forespørgslerne (Mads). Evt. fejlrate pr. rute og ydelse
  (Web Vitals) kan komme som flere felter på samme port.
