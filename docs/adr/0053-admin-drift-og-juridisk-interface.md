# 0053 — Admin-drift og juridisk interface: indsigtsudtrækkets form og integrationsstatus via factoryen

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 5 (5.4 admin-del + 5.5)
- **Berører uafklaret punkt:** ja — ToS + honoraraftale (ejer), samtykke (ejer), opbevaringspligt
  vs. sletning (ejer/jura), vurderinger-om-en-partner vs. indsigtsret (ejer/jura)

## Kontekst

To admin-flader bygges skærm-først (ADR 0042): `/admin/drift` (driftsoverblik) og
`/admin/juridisk` (juridisk download-interface, byggespec §11). Begge er læse-/udtrækkeflader;
ingen ændrer forretningstilstand. Tre ting krævede et valg:

1. Hvordan driftsskærmen ved hvilke integrationer der kører — uden at opfinde sin egen mening
   om hvad der er konfigureret.
2. Hvad et indsigtsudtræk (GDPR art. 15) indeholder, hvilken form det har, og hvor admin-værnet
   sidder, når udtrækket kræver service-role.
3. Hvad der gøres ved de huller skærmen afslører: ingen samtykketabel, ingen sletteaction,
   ingen ToS/honoraraftale.

## Overvejede muligheder

**Integrationsstatus**
- *A — læs `FLAG_*` og leverandørnøglerne direkte.* Ligetil, men nøglenavnene bor i
  `src/lib/<vendor>/`; en skærm med sin egen kopi kan lyve efter et adapter-skift.
- *B — spørg factoryen* (`createX(env).name`). Skærmen følger altid adapter-valget.

**Indsigtsudtræk — hvor henter vi data**
- *A — SQL-funktion/view der returnerer alt for en bruger.* Kræver en migration og en
  `security definer`-funktion (ADR 0047-risikoen: eksponeret via `/rest/v1/rpc`).
- *B — TypeScript-indsamling over eksisterende tabeller, service-role bag admin-tjek.* Ingen
  migration, ingen ny angrebsflade; indsamling og sammensætning kan testes uden database.

**Indsigtsudtræk — transport**
- *A — GET med e-mail i URL'en.* E-mail i query-strengen ender i serverlogs og browserhistorik.
- *B — POST med formularkrop, JSON-download.* Ingen persondata i URL'en.

## Beslutning

**Integrationsstatus: B.** `getIntegrationOverview` kalder hver factory og klassificerer
adapterens `name` som `real` / `demo` / `stub`. Flagets tilstand læses fra `isEnabled`, så
skærmen skelner "flaget er slukket" fra "flaget er tændt, men nøglerne mangler" (samme skel
som ADR 0048). Ni porte; `FLAG_DEMO`-tilstanden vises som en advarsel, fordi den skal være
slået fra ved launch (`docs/fase-6.md` §6.4). PostHog-*driftstatus* (fejlrate, seneste fejl)
vises ikke — den kræver en live nøgle og en query-adapter; skærmen linker til PostHog og
kalder det en `TODO(mads)`. Ingen falske tal.

**Driftstal** læses via den *authede* klient: admin-RLS findes allerede på alle tabellerne
(`board`, `partner_profile`, `membership`, `payment_charge`, `meeting`, `meeting_partner`,
begge webhook-event-tabeller), så service-role er ikke nødvendig. Hver sektion hentes for
sig; en sektion der fejler bliver `null` og vises som "—" med en forklaring, aldrig som et nul.
Rækkegrænsen (PostgREST' 1000) markeres som "≥" frem for at lade et afkortet tal passere.
Én begrænsning følger af RLS: `app_user` har kun en self-policy, så admin kan ikke tælle
*ejere* direkte. Skærmen viser "ejere med board" (distinkte `board.owner_id`) og kalder det
præcis det. En admin-policy på `app_user` er en migration og kan komme når tallet efterspørges.

**Indsigtsudtræk: B + B.**
- `POST /api/admin/indsigt` (formularen sender `email`; svaret er `attachment` JSON,
  `no-store`). Filnavnet bærer dato, aldrig person.
- Rækkefølgen ligger i `requestSubjectAccess` og er testet: bruger → admin-rolle → *først
  derefter* bygges service-role-fetcheren (lazy). En ikke-admin — også en ejer der beder om
  sin *egen* indsigt — får aldrig en klient der bypasser RLS. `/api` er uden for proxyen
  (adgangsporten og sessionsopfriskningen kører ikke dér), så handleren bærer hele sit eget
  værn; derudover afvises cross-site-anmodninger (`Sec-Fetch-Site`).
- **Form:** ét JSON-dokument med `person`, `roller`, et `ejer`-afsnit (boards, rådgivere,
  medlemskab, betalingstræk, møder inkl. noter og dagsorden, quizsvar, afgivne vurderinger),
  et `partner`-afsnit (profil, egne tags, boards, mødedeltagelse, egne noter og
  forberedelsesnoter, afgivne vurderinger), `samtykke` og `afgraensning`. Rolle-afsnit er `null`
  når personen ikke har dem.
- **Afgrænsning står i selve udtrækket** (`afgraensning.ikke_inkluderet`), så det aldrig kan læses
  som "alt vi har": data hos databehandlere (kun referencer er med), Supabase Auth-kontoen,
  *modtagne* vurderinger af en partner, andre partneres forberedelsesnoter, honorar, AI-resuméer
  og samtykkelog.
- Indsamlingen går gennem en `RowFetcher`; kun den ene person's nøgler bruges som filter (bruger-id,
  partner-profil-id, board-id'er) — aldrig en bred læsning filtreret bagefter. Rammer en tabel
  rækkegrænsen, *kaster* indsamlingen: et juridisk udtræk må ikke være stille afkortet.
- **Ingen persondata i logs.** Der logges kun at et udtræk kørte og af hvilken admin; fejlbeskeder
  nævner tabel og databasefejl, aldrig filterværdier.

**Hullerne gøres synlige, ikke fyldt ud:**
- *Samtykkelog:* der findes ingen samtykketabel — samtykke er en typet kerne
  (`src/server/consent`) og en cookie i browseren. Skærmen siger det, og der tilbydes ingen
  tom CSV. Registreret i stub-registret.
- *ToS og honoraraftale:* vises som "Ikke udarbejdet — afventer ejer" (`TODO(ejer)`). Interfacet
  er bygget, indholdet er ejerens.
- *Leverandør-register og sletteflow:* vises som repo-stier i tekst. `docs/` bundles ikke på
  Netlify, så siden læser ikke filer via `fs`.
- *Sletning:* der bygges **ingen** admin-sletteaction. Den er destruktiv, rører flere
  databehandlere og afhænger af opbevaringspligt (bogføring, betalingsdata) som ejer/jura skal
  afklare (`docs/gdpr/sletteflow.md`). Egen skive.

**Intet nyt feature-flag og ingen migration.** Begge flader læser; der er intet modul at skjule
(samme begrundelse som ADR 0048), og ingen ny tabel eller SQL.

## Konsekvenser

- Positive: begge skærme kan klikkes på sua-abaas.netlify.app nu. Integrationsstatus kan ikke
  komme ud af trit med adaptervalget. Udtrækket kan afprøves uden database, og dets afgrænsning
  er eksplicit i selve filen.
- Negative / pris: indsamlingen er ~20 forespørgsler pr. udtræk (ét admin-kald, sjældent). Hver ny
  tabel med persondata kræver at indsamlingen *og* sammensætningen udvides — en test, der gennemgår
  schemaet og fejler på en uregistreret persontabel, mangler (se opfølgning). Der er ingen
  revisionslog over hvem der har hentet et udtræk ud over én logline.
- Opfølgning:
  - TODO(ejer/jura): må *modtagne* vurderinger af en partner med i partnerens indsigtsudtræk
    (evt. uden afgiver)? Indtil da er de udeladt og oplistet under afgrænsningen.
  - TODO(ejer): samtykke — en `consent_event`-tabel (hvem, kategori, tidspunkt, tekstversion)
    forudsætter samtykketeksten. Først derefter kan en CSV-eksport bygges.
  - TODO(ejer): ToS og honoraraftale.
  - TODO(mads): PostHog-driftstatus (kræver live nøgle); persistent revisionslog over udtræk
    (tabel + RLS); en admin-select-policy på `app_user` hvis "ejere uden board" skal tælles.
  - Honorar kobles på driftsskærmen, når honorarskiven lander.
  - Sletteaction: egen skive efter ejer/jura-afklaring af opbevaringspligt.
