# 0068 — GDPR-sletning (art. 17): plan, én transaktion (`erase_data_subject`), eksterne behandlere via porte og en kvittering uden persondata

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 5 (5.5 juridisk interface) + 6 (GDPR-verifikation) — lukker backlog-punkt B-68
- **Berører uafklaret punkt:** ja — **opbevaringspligt** (bogføring, betaling, honorar: 🔴 ejer/jura),
  **slette-SLA** (ejer) og **lead-partner: tildelings- og rotationsregler** (ejer). Ingen af dem er
  besluttet her; sletningen er bygget **fail-closed** omkring dem.

## Kontekst

ADR 0053 gav admin et indsigtsudtræk (art. 15) og lod sletningen (art. 17) stå som «egen skive»: den er
destruktiv, rører flere databehandlere og afhænger af opbevaringspligt som ejer/jura skal afklare.
`docs/gdpr/sletteflow.md` var en skitse. Tre ting skulle afgøres for at bygge den:

1. **Hvad må flowet slette, når opbevaringspligten ikke er afklaret?** Bogførings- og betalingsdata kan være
   underlagt lovpligtig opbevaring; hvad der er bogføringsbærende er ikke besluttet.
2. **Hvordan holdes boardets invarianter (B-68)?** `board_partner.partner_id` er `on delete cascade` (0010):
   en sletning af en katalogpost tager partneren af alle sine boards uden at 2-3 partnere / mindst én intern
   / præcis én lead holdes, og uden at Cal.com-hosts opdateres.
3. **Hvordan slettes hos eksterne behandlere**, når kun to af dem har en dokumenteret slette-API, og hvad
   sker der med Supabase-sletningen hvis en af dem fejler?

## Overvejede muligheder

**Opbevaringspligt**
- *A — bygge en regel* («betalingsdata gemmes 5 år, resten slettes»). Det er en juridisk beslutning, ikke en
  teknisk — og et forkert tal ville enten slette bogføringsmateriale eller nægte en person sin ret. Afvist.
- *B — fail-closed.* **Valgt.** En person med betalingsdata kan ikke slettes af flowet; skærmen siger
  «Afventer afklaring af opbevaringspligt (TODO(ejer/jura))» og stopper. Når ejer/jura har afgjort, bliver
  reglen én ændring i planen og funktionen, ikke en omskrivning.

**Hvad regnes som «betalingsdata»**
- *A — kun `membership`/`payment_charge` på et board personen ejer* (opgavens afgrænsning).
- *B — også honorargrundlaget:* `meeting_partner.registered_status` er partnerens afholdt/afbud/udeblivelse og
  er grundlaget for udbetalingen til partneren (ADR 0051); udbetaling er bogføring. **Valgt som tillæg.**
  Sletter vi en ejers board, cascader møderne og dermed *andre partneres* honorargrundlag; sletter vi en
  partner, forsvinder grundlaget for vedkommendes eget honorar. Begge blokerer, indtil ejer/jura har svaret.
  Konsekvens: i praksis kan en partner der har holdt et registreret møde ikke slettes endnu.

**Hvor Supabase-sletningen sker**
- *A — TypeScript i trin* (slet board, slet profil, …). Fejler et senere trin, står personen halvt slettet, og
  `board_partner`'s cascade rammer boardet stille. Afvist (samme argument som B-66, ADR 0064).
- *B — en `security invoker`-plpgsql-funktion `erase_data_subject`, revoked fra klientrollerne.* **Valgt**, som
  `change_board_composition`: én transaktion, ingen ekstra rettigheder, kun service-role bag admin-tjekket.

**Boardets invarianter (B-68)**
- *A — `on delete restrict` på `board_partner.partner_id`.* Ville blokere al fremtidig sletning af en
  katalogpost via databasen, også admins redigering af kataloget. Ikke nødvendigt for at løse B-68.
- *B — funktionen fjerner partneren fra hvert board via `change_board_composition` FØR katalogposten slettes.*
  **Valgt.** Invarianterne håndhæves af den eksisterende sammensætningsfunktion (sidste værn), revisionsrækken
  (`board_change`) skrives i samme transaktion, og lead-reglen bliver i TypeScript (`planBoardChange`) — den er
  stadig et ejer-punkt og skal ikke kopieres til SQL. Funktionen får **planen** (`p_board_removals`), ligesom 0026.
  Kan et board ikke fjernes fra uden at bryde reglerne, **blokeres sletningen** og skærmen viser hvilke boards
  admin skal rette først (udskift partneren). Funktionen afviser desuden at slette katalogposten hvis partneren
  stadig sidder på et board (cascade må aldrig tage partneren stille).

**Eksterne behandlere og fejl**
- *A — rul Supabase tilbage hvis en behandler fejler.* Gør en leverandørs oppetid til en betingelse for en
  persons ret, og bryder «Supabase er sandhedskilde». Afvist (samme argument som ADR 0062).
- *B — Supabase-sletningen står; fejlen registreres som «mangler» på kvitteringen.* **Valgt.**
- *Kontoankeret.* Slettes `auth.users`-rækken før eksterne behandlere er færdige, kan en genkørsel ikke længere
  finde personen (e-mailen er opslagsnøglen til Resend, id'et til PostHog). Derfor **beholdes `app_user`-rækken
  som blankeret anker** (navn og telefon fjernet, e-mail beholdt) til Auth-sletningen — og Auth-kontoen slettes
  først når ingen *genkørbar* behandler (PostHog, Resend) fejlede. Triggeren fra 0004 fjerner ankeret når Auth-
  brugeren slettes. Cal.com er ikke genkørbar (møderne er væk fra Supabase), så en Cal.com-fejl holder ikke
  kontoen tilbage men står som hul på kvitteringen.

**Hvor portene bor**
- *A — en `eraseDataSubject`-metode på hver eksisterende port* (`Analytics`, `EmailSender`, …). Analytics har
  slet ingen rigtig adapter endnu, og PostHogs sletning kræver en *anden* nøgle (personal API key med skrive-
  scope) end ingest-nøglen.
- *B — et eget modul `src/lib/erasure/`* med en `ProcessorEraser` pr. behandler (rigtig / demo / stub), samme
  factory-mønster som resten (ADR 0004/0041). **Valgt.** Ikke i `getAdapters()` (en liste af erasers hører ikke
  til dér, og registrets «alt er stub»-test gælder enkeltporte).

## Beslutning

**1. Plan før handling** (`src/server/erasure/plan.ts`). `readErasureFacts` læser alt der hænger på personen
(kun personens egne nøgler, gennem `RowFetcher` som indsigtsudtrækket); `computeErasurePlan` er ren og
unit-testet. Planen indeholder: hvad der slettes (optalt), hvad der anonymiseres (aktør i `board_change`), hvad
der **blokerer** (opbevaringspligt betaling, opbevaringspligt honorar, boardets invarianter med boardnavne,
«admin kan ikke slette sig selv», «sidste admin»), planen for hvert board partneren fjernes fra, og hvilke
eksterne behandlere der får besked — automatisk eller manuelt. Planen bærer aldrig e-mail eller telefon.

**2. Udførelse** (`src/server/erasure/execute.ts`, `request.ts`, `actions.ts`). Admin-only: rollen udledes af
sessionen, og service-role/Auth-admin/adaptere bygges *lazy* efter admin-tjekket (en ejer får aldrig en klient
— heller ikke til sin egen sletning; selvbetjent sletning er en anden skive). **To-trins bekræftelse:**
«Slå op» viser planen og skriver intet; «Slet» kræver at e-mailen skrives igen og matcher kontoen. Idempotent:
er kontoen væk, svarer flowet «ikke fundet» og kalder intet; står den blankeret tilbage, gentages de eksterne
skridt og funktionen finder intet at slette. Rækkefølge: bekræft → plan (blokeringer afviser *før* noget
skrives) → `erase_data_subject` (én transaktion) → Cal.com (hosts på de berørte boards, kommende bookinger
aflyses) → PostHog/Resend → Supabase Auth (`auth.admin.deleteUser`) og ankeret → kvittering.

**3. Migration `0028_erasure.sql`.**
- `erasure_receipt`: `subject_hash` (SHA-256 hex af bruger-id'et — pseudonymt), `requested_by` (admin,
  `on delete set null`), `executed_at`, `outcome` (`gennemfoert` | `delvist`), `systems` (liste af
  `{system, status, detail}` med faste tekster), `missing`. **Ingen persondata.** RLS (ADR 0007): kun admin
  læser, ingen write-policies; rækker skrives af service-role.
- `erase_data_subject(p_user_id, p_actor_id, p_board_removals)`: `security invoker`, revoked fra
  `public`/`anon`/`authenticated`. Låser personen; **fail-closed på opbevaringspligt** (medlemskab/træk på et
  ejet board, registreret honorargrundlag) også her, fordi et medlemskab kan opstå mellem plan og udførelse;
  afviser selvsletning og den sidste admin; fjerner partneren fra hvert board via `change_board_composition`
  (invarianter + spor, aktør = udførende admin); afviser at slette katalogposten hvis partneren stadig sidder
  på et board; sletter boards, katalogpost og alt der hænger på brugeren; nulstiller aktør i `board_change` og
  `published_by`; blankerer ankeret.

**4. Eksterne behandlere** (`src/lib/erasure/`). **Rigtig implementering kun hvor API'et er dokumenteret:**
- *PostHog* (`DELETE /api/projects/:id/persons/:uuid/?delete_events=true&delete_recordings=true`, dokumenteret
  under «Right to be forgotten»; opslaget går via HogQL og `person_distinct_ids`). Distinct-id = bruger-id.
  Appen kalder endnu ikke `identify`, så en person er normalt «intet at slette».
- *Resend* (`DELETE /contacts/{id_or_email}`). Vi opretter ikke kontakter, så svaret er normalt 404.
  Mailloggen (retention hos Resend) kan ikke slettes via API og står som note.
- *Cal.com:* hosts opdateres efter fjernelsen (`syncBoardHosts` + `settleBoardChangeSync`, som ADR 0062/0064),
  og kommende bookinger aflyses via `BookingProvider.cancelMeeting`. Attendee-data på tidligere bookinger og
  partnerens team-sæde har ingen verificeret API → **manuelt hul** på kvitteringen.
- *inMobile* og *Ordbogen*: ingen verificeret slette-API → manuelle huller (vises kun når personen har et
  nummer / resuméer).
- *Alunta, QuickPay, Nets, e-conomic/Dinero:* sletter flowet aldrig; en person med data dér er blokeret.
- Stub kaster `NotConfiguredError` (kvitteres «Ikke konfigureret» — et synligt hul, ikke en sletning); demo
  kvitterer `DEMO-ERASE-…`; rigtige nøgler vinder altid over demo.

**5. UI** (`/admin/juridisk`, `ErasurePanel`, `ErasureReceipts`). «Sletning (art. 17)» ved siden af
indsigtsudtrækket: slå op → plan (slettes / anonymiseres / blokeret / eksterne) → bekræft → kvittering, og en
liste over de seneste kvitteringer (id-hash forkortet til 12 tegn). En blokeret plan har ingen bekræftelsesknap.
Ingen nye CSS-klasser; kun eksisterende token-klasser.

**6. Skemaet er registreret.** `tests/db/erasure.test.ts` låser listen af fremmednøgler til `app_user` og
`partner_profile` fast: kommer der en ny tabel med persondata, fejler testen, og sletningen (og listen) må
udvides bevidst. Det er den test ADR 0053 savnede, for sletningens vedkommende.

## Konsekvenser

- Positive: B-68 er lukket — en katalogpost kan ikke længere forsvinde stille fra et board; sletning er
  atomisk og fail-closed; admin ser præcis hvad der sker før noget sker, og kvitteringen viser hvad der mangler.
  Når ejer/jura afgør opbevaringspligten, er det én regel at ændre. Alt er testet uden netværk (plan, orkestrering,
  adaptere) og mod rigtig Postgres (funktion, revoke, RLS, skemaregistret).
- Negative / pris:
  - **En person med et medlemskab, betalingstræk eller registreret honorargrundlag kan ikke slettes** — det er
    meningen, men i praksis rammer det næsten alle ejere der har betalt, og alle partnere der har holdt et møde.
    Indtil ejer/jura har svaret, er den eneste vej manuelt (og så uden for flowet).
  - Modtagne vurderinger *om* en partner slettes med katalogposten (schemaets cascade, 0015). Om de i stedet skal
    anonymiseres er et jura-spørgsmål (se ADR 0053's opfølgning).
  - Slettes en ejers board, slettes alle møder, noter og vurderinger på det — også partneres noter og vurderinger.
    Det er møder om ejeren; opbevaringspligt for honorargrundlaget blokerer allerede (ovenfor).
  - Cal.com-sædet og -attendee-data, inMobile og Ordbogen kræver manuel sletning indtil API'erne er verificeret;
    de står som huller på hver kvittering.
  - Et lille vindue findes mellem Supabase-sletningen og Auth-sletningen, hvor kontoen står blankeret (kun e-mail).
  - Sletning af selve `auth.users` kan ikke afprøves lokalt mod Supabase; testene bruger en fake af `auth.admin` og
    en shim af `auth.users` (0004-triggeren er dækket i db-testen).
- Opfølgning:
  - **TODO(ejer/jura):** opbevaringspligt — hvad er bogføringsbærende, i hvor lang tid, og hvad må anonymiseres i
    stedet for at slettes (betaling, honorar, partnerens modtagne vurderinger)? Først derefter kan blokeringerne
    blødes op.
  - **TODO(ejer):** slette-SLA — hvor hurtigt skal en anmodning effektueres? Flowet er manuelt udløst af admin.
  - **TODO(ejer):** lead-partner-regler (uændret) — fjernelsen af en lead bruger pladsholderreglen i
    `planBoardChange`.
  - **TODO(mads):** PostHog — bekræft scope (`person:write`) og at `delete_recordings` accepteres; sæt `identify`
    med bruger-id'et hvis analytics skal kunne kobles til en konto. Resend — bekræft `/contacts/{email}` på vores
    konto-type og mailloggens retention. Cal.com — verificér en API til at fjerne attendee-data og frigive et sæde.
    inMobile og Ordbogen — dokumenteret slette-API.
  - Selvbetjent sletning (en ejer sletter sin egen konto) og en revisionstabel over indsigtsudtræk er egne skiver.
  - Fase 6: sletteflowet skal afprøves ende-til-ende mod rigtige systemer (`docs/fase-6.md`).
