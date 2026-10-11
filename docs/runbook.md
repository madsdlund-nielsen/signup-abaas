# Runbook — når noget fejler

> Fase 6.5. Pr. system: **symptom → hvor man ser det → hvad man gør → hvem**. Kun ting koden
> faktisk understøtter står her; hvor en handling hører til leverandørens egen skærm, siges det.
> Overblik først: `/admin/drift` (hvad kører, hvad er faldet) og `/admin/klar` (hvad mangler før launch).
> Teknisk ansvarlig er Mads; forretningsbeslutninger er ejernes (Andreas og Mette).

## Fire steder at kigge — altid i denne rækkefølge

1. **`/admin/klar`** — er miljøet sat rigtigt? Mangler en hemmelighed, står en port som stub, er `FLAG_DEMO` tændt?
2. **`/admin/drift`** — tal for betalingstræk (fejlede med årsag), møder der burde være afsluttet, manglende
   partner-registreringer, de ti seneste webhook-hændelser pr. leverandør, og PostHog-status.
3. **Netlify → Logs → Functions** — her ender serverfejl. Fejl der skulle til PostHog (`captureException`) ender
   *indtil videre* som linjer med `[analytics:stub] exception`, fordi skrive-adapteren til PostHog ikke er bygget endnu
   (`docs/stub-register.md`). Søg på `source` (`alunta-webhook`, `calcom-webhook`, `charge-periods-cron`, `summaries-cron`).
4. **Supabase → Table editor** — sandhedskilden. Webhook-tabellerne er `payment_webhook_event` og
   `meeting_webhook_event`; udsendelseslogget er `notification_delivery`. Skemaet står i `docs/reference/schema.md`.

Ruterne og deres beskyttelse står i `docs/reference/routes.md`; miljøvariablerne i `docs/reference/env.md`.

---

## Betaling (Alunta) — webhook og opkrævninger

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Ejer har registreret kort, men medlemskabet står stadig «kort mangler» | `/admin/drift` → Medlemskaber (Kort mangler); `payment_webhook_event` har ingen nyere række | Tjek at `ALUNTA_WEBHOOK_SECRET` er sat i Netlify **og** er den samme som i Aluntas webhook-opsætning. Gen-lever hændelsen fra Alunta, hvis de tilbyder det — handleren er idempotent, så samme hændelse anvendes præcis én gang | Mads |
| Alunta melder 503 på webhook-kaldet | Netlify-log: «Webhook er ikke konfigureret» | `ALUNTA_WEBHOOK_SECRET` eller Supabase-nøglerne mangler i Netlify. Sæt dem og gen-deploy | Mads |
| Alunta melder 401 | Netlify-log: «Ugyldig signatur» | Hemmeligheden afviger mellem Netlify og Alunta. Sæt dem ens. Signaturtjekket slås aldrig fra | Mads |
| Alunta melder 500 på en hændelse | Netlify-log med `source: alunta-webhook` og et `step` | Hændelsen er rullet tilbage (ingen halvt anvendt tilstand), så Alunta kan gen-levere den og den prøves igen. Ret årsagen (typisk en databasefejl) og lad Alunta gen-levere | Mads |
| «Allerede behandlet» (200) ved gen-levering | — | Det er korrekt: idempotensen virker. Intet at gøre | — |
| Betalingstræk står som **Fejlet** | `/admin/drift` → Betalingstræk, med leverandørens fejlårsag | Ejeren får en besked om fejlet betaling (kræver `FLAG_EMAIL`, en live skabelon for typen «Fejlet betaling» og `NEXT_PUBLIC_APP_URL`). Hvad en fejlet betaling betyder for adgang og honorar er **ikke besluttet** (ejer); koden registrerer kun status og årsag | Andreas og Mette beslutter; Mads følger op med ejeren |
| Perioder bliver ikke oprettet; træk står som «afventer» | `/admin/drift` → Betalingstræk (Afventer vokser) | Den planlagte kørsel (`netlify/functions/charge-periods.ts`, dagligt kl. 03:00 UTC) kalder `/api/cron/charge-periods`. Tjek Netlify → Functions → `charge-periods`. 503 = `CRON_SECRET` mangler; 401 = forkert hemmelighed; «skipped» = `FLAG_PAYMENTS` er slået fra. Uden Alunta-nøgler bliver træk liggende som «afventer» (stub) — det er ikke en fejl | Mads |
| Kørslen skal tvinges nu | — | `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<site>/api/cron/charge-periods`. Kørslen er idempotent pr. periode | Mads |
| Alunta kan ikke fakturere hver 4. uge | `docs/backlog.md` B-35 | Kendt: Aluntas API kender kun måneder. Åbent punkt hos Mads — ikke et driftsproblem | Mads |

## Booking (Cal.com) — webhook og boards

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Et møde opdateres ikke efter aflysning/flytning i Cal.com | `/admin/drift` → Møder («Planlagt, men tiden er passeret»); `meeting_webhook_event` mangler en række | `CALCOM_WEBHOOK_SECRET` skal være sat i Netlify og være den samme som i Cal.coms webhook. 503 = mangler; 401 = forkert. Gen-lever fra Cal.com (idempotent) | Mads |
| Webhook giver 500 | Netlify-log med `source: calcom-webhook`, `step` | Idempotensrækken rulles tilbage, så gen-levering prøver igen. Ret årsagen og gen-lever | Mads |
| En booking oprettet direkte i Cal.com dukker ikke op | Hændelsen `calcom_webhook_ukendt_uid` (i loggen, indtil PostHog-adapteren er bygget) | Bevidst: webhooken opretter ikke møder, kun opdaterer kendte. Book via platformen | — |
| Board mangler Cal.com-booking | `/admin/boards/[id]` → Cal.com: «Event type: ikke oprettet» | Knappen **Opret Cal.com-event type**. Kræver `CALCOM_API_KEY` og `CALCOM_TEAM_ID` og at hver partner har et Cal.com-sæde | Mads / admin |
| «Cal.com-hosts ikke opdateret — kør Opdatér hosts» | Notits på `/admin/boards/[id]` | Knappen **Opdatér hosts på Cal.com-event type**. Opstår når boardets partnere er ændret, men Cal.com ikke svarede. En senere vellykket opdatering ophæver advarslen | admin |
| «Mangler Cal.com-bruger-id: <navn>» | `/admin/boards/[id]` | Sæt partnerens sæde under `/admin/partners/[id]` («Gem Cal.com-bruger») og kør derefter Opdatér hosts | admin |
| Booking fejler overfor ejeren | Netlify-log; port «Booking» på `/admin/klar` | Står porten som stub/demo, mangler nøgle eller flag (`FLAG_BOOKING`). Cal.com EU-residens og optagelse på Teams er desuden uafklarede (Mads, spike L-7/L-8) | Mads |
| Partner er booket uden for sin tilgængelighed | — | Tilgængelighed lever kun i Supabase; en booking oprettet direkte hos Cal.com omgår vagten (kendt hul, stub-registret) | Mads |

## Video (Cal Video)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| «Deltag» fører ikke til et møde | `/moeder/[id]`; port «Video» på `/admin/klar` | Videoadapteren er endnu ikke bygget (stub-registret): mødelinket kommer fra Cal.com-bookingen. Tjek at bookingen findes og har et mødelink. I demo-tilstand fører «Deltag» til `/moeder/rum/…` (en demoside) — **FLAG_DEMO skal være slukket i drift** | Mads |
| Ingen optagelse efter mødet | `/moeder/[id]` (resumé «mangler optagelse») | Native optagelse på Cal.com Teams er uverificeret (spike L-8). Kan ikke løses i platformen | Mads |

## Notifikationer (e-mail og SMS)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Ingen mails sendes | `/admin/notifikationer` (Seneste udsendelser, status `Stub`/`Demo`/`Fejlet`); port «E-mail» på `/admin/klar` | `Stub`/`Demo` = intet er koblet på: sæt `FLAG_EMAIL=true`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`. Afsenderdomænet skal være oprettet i Resends EU-region (`eu-west-1`) | Mads |
| Udsendelse fejlet: «ingen live skabelon» | `/admin/notifikationer` | Motoren sender aldrig en opfundet tekst. Skriv og **publicér** skabelonen under «Redigér skabeloner» for typen og kanalen | admin |
| Udsendelse fejlet: «variablen link har ingen værdi» | Samme sted | `NEXT_PUBLIC_APP_URL` mangler i Netlify | Mads |
| SMS sendes ikke | Samme sted | Modtageren har ikke angivet et telefonnummer på `/konto`, eller inMobile er ikke koblet på (`FLAG_SMS`, `INMOBILE_*`). Adapteren er aldrig kørt mod en rigtig konto | Mads |
| Påmindelser og anmodninger om vurdering sendes aldrig | `/admin/notifikationer` (tidspunkt «Ikke fastlagt») | Bevidst: tidspunkterne er ejernes beslutning, og den planlagte rute `/api/cron/notifications` er ikke planlagt | Andreas og Mette |
| Link til vurdering virker ikke | Modtagerens besked linker til `/moeder/[id]` i stedet | `RATING_LINK_SECRET` mangler eller er kortere end 32 tegn — så er engangslinks slået fra (`/admin/klar`). Roteres hemmeligheden, bliver alle udestående links ugyldige | Mads |

## AI-resumé (planlagt kørsel)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Intet resumé efter et afholdt møde | `/moeder/[id]` (status på resuméet); Netlify → Functions → `summaries` (hvert 15. minut) | Kørslen kalder `/api/cron/summaries`. «skipped» = `FLAG_AIFOLLOWUP` slået fra; 503 = `CRON_SECRET` eller Ordbogen-nøgle mangler; 401 = forkert hemmelighed | Mads |
| Resuméet viser «mangler optagelse» | `/moeder/[id]` | Mødet har ingen optagelse/transskription. Tjekkes igen ved hver kørsel; løses når optagelsen findes | Mads |
| Resuméet viser «mangler samtykke» | `/moeder/[id]` | Grundlaget for optagelse (kontrakten) er ikke registreret for mødet. Samtykke stubbes aldrig. Tjekkes igen ved hver kørsel | Andreas og Mette (ToS), Mads |
| Resuméet står som **fejlet** | `/moeder/[id]` | Efter tre forsøg opgives det. Ejeren kan trykke **Generér igen** (nulstiller forsøg). Fejlkoden i loggen er bevidst kort og uden indhold | ejeren / Mads |
| Resuméet hænger på «genereres» | `meeting_summary.status` | Låsen frigives automatisk efter 30 minutter; næste kørsel overtager | — |

## Hosting (Netlify)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Siden er nede eller viser en fejlside | Netlify → Deploys / Logs → Functions | Skyldes fejlen en ny deploy, så publicér det forrige vellykkede deploy igen i Netlify (Deploys). Tjek derefter `/admin/klar` | Mads |
| En ændring i dokumentation udløste ingen bygning | — | Bevidst: `netlify.toml` springer build over for ændringer der kun rører docs, tests, CI eller agent-config | — |
| Serverkoden kører uden for EU | Netlify → Project configuration → Build & deploy → Functions region | Skal stå på EU (Frankfurt). Kræver Pro-plan. Punktet står som åbent hos Mads (`/admin/klar`) | Mads |
| En hemmelighed skal skiftes | Netlify → Environment variables | Skift værdien, gen-deploy. `CRON_SECRET` bruges af både ruten og den planlagte funktion — samme variabel, ét sted. `ALUNTA_WEBHOOK_SECRET` og `CALCOM_WEBHOOK_SECRET` skal skiftes **samtidig** hos leverandøren. `RATING_LINK_SECRET` ugyldiggør udestående links | Mads |
| Hele sitet viser en adgangskodeside | `/gate` | Adgangsporten (APP_GATE_*) er aktiv. Slå fra ved at fjerne `APP_GATE_ENABLED` og gen-deploye. Delvis opsætning er *inaktiv* og flagges på `/admin/klar` | Mads |
| «DEMO» står i toppen af siderne | — | `FLAG_DEMO` er tændt. Fjern den og gen-deploy; demo-data er åbenlyst falsk og må ikke være i drift | Mads |

## Database (Supabase)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Alt fejler med forbindelses-/auth-fejl | Netlify-log; Supabase → Project status | Free-tier pauser efter en uges inaktivitet — projektet skal på Pro (`docs/accounts-to-create.md`). Tjek at de tre Supabase-variabler er sat i Netlify | Mads |
| En ny migration skal i produktion | — | `npm run db:push` (Supabase CLI, ADR 0015) efter at CI er grøn. Migrationer redigeres aldrig bagefter; en ny rettelse får et nyt nummer | Mads |
| Mistanke om at en bruger ser andres data | `docs/reference/schema.md` (RLS pr. tabel, policies) | Alle tabeller har RLS (genereret oversigt). Policy-testene i `tests/db/` har negative cases. Er der tvivl: stands adgangen (`/admin/klar`, adgangsporten) og kontakt Mads | Mads |
| En ejer vil have sine data udleveret | `/admin/juridisk` | Indsigtsudtræk (GDPR art. 15) for en e-mailadresse. Der er endnu **ingen sletteknap** — sletning er en egen opgave efter ejer/jura-afklaring (`docs/gdpr/sletteflow.md`) | admin / Mads |

## Analytics (PostHog)

| Symptom | Hvor man ser det | Hvad man gør | Hvem |
|---|---|---|---|
| Driftssektionen siger «Ikke koblet på» | `/admin/drift` | `POSTHOG_PERSONAL_API_KEY` (kun læse-scope) og `POSTHOG_PROJECT_ID` mangler, eller `FLAG_ANALYTICS` er slukket. Siden vælter aldrig af en PostHog-fejl | Mads |
| Ingen events/fejl i PostHog | Netlify-log: `[analytics:stub]` | Skrive-adapteren til PostHog er ikke bygget (stub-registret). Fejl ses i Netlify-logs indtil da | Mads |
| Cookie-banneret / samtykke | — | Analytics kræver samtykke (eneste bevidste undtagelse fra kontrakt-som-grundlag). Uden samtykke sendes intet | — |

---

## Når du ikke ved hvor du skal starte

1. Åbn `/admin/klar`. Står noget rødt som ikke burde være? Ret det først.
2. Åbn `/admin/drift`. Hvilket tal er forkert: træk, møder eller webhooks?
3. Find hændelsen i Netlify-loggen, og slå systemet op ovenfor.
4. Er det en beslutning (pris, honorar, tidsfrister, vilkår) frem for en fejl, så er svaret ikke i koden — se listen over åbne
   beslutninger nederst på `/admin/klar` og `docs/overlevering.md`.
