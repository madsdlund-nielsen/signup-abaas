# 0064 — Boardets sammensætning som én transaktion (`change_board_composition`), hosts ved sædeskift og revisionssporet i indsigtsudtrækket

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 1 (board) + 2 (Cal.com) + 5 (GDPR) — lukker backlog-punkterne B-65, B-66 og B-67
- **Berører uafklaret punkt:** nej — lead-reglen ("bevar lead, ellers den indkommende, ellers første
  interne") er stadig en pladsholder (`TODO(ejer): lead-partner regler`) og bor stadig kun i
  TypeScript. Intet nyt forretningstal, ingen ny pris eller leverandør.

## Kontekst

ADR 0062 gav ejer og admin en fælles skrivevej til boardets sammensætning og lod tre ting stå åbent:

- **B-66.** `applyPlan` skrev i trin (indsæt → slet → flyt lead), fordi supabase-js ikke har
  transaktioner. Fejlede et senere trin, stod boardet i en mellemtilstand; to samtidige ændringer
  (ejer + admin) kunne læse samme udgangspunkt; og revisionsrækken blev skrevet bagefter som en
  separat, best-effort handling — så en ændring kunne findes uden spor.
- **B-67.** Ændrede admin en partners Cal.com-sæde (`setPartnerCalcomUserId`), pegede event typernes
  `hosts` stadig på det gamle sæde, til nogen kørte "Opdatér hosts" på hvert berørt board.
- **B-65.** Indsigtsudtrækket (ADR 0053) manglede revisionssporet: en persons egne board-ændringer
  (`board_change.actor_id`) var ikke med, og det samme gjaldt de nyere tabeller fra ADR 0057/0059/0060
  (`notification_delivery`, `meeting_summary`, `rating_link`).

## Overvejede muligheder

**Hvordan sammensætningen bliver atomisk (B-66)**
- *A — behold trinene, og skriv en kompenserende oprydning ved fejl.* Kompensation er en transaktion
  uden garantier: dør processen midt i, er den ikke kørt. Afvist.
- *B — en `security definer`-funktion.* Ville give funktionen mere rettighed end kalderen og kunne
  eksponeres via `/rest/v1/rpc` (ADR 0047). Unødvendigt: kun service-role kalder den.
- *C — en `security invoker`-plpgsql-funktion, revoked fra klientrollerne.* **Valgt.** En
  plpgsql-funktion er én transaktion; ingen ekstra rettigheder; samme guardede revoke som 0016/0021/0023.

**Hvad funktionen får at vide (B-66)**
- *A — selve ændringen (`tilfoej`/`fjern`/…), og funktionen udleder resten.* Så skal lead-reglen
  duplikeres i SQL — og den er et uafklaret ejer-punkt, der ikke skal bo to steder.
- *B — planen* (hvem der indsættes, fjernes, og hvem der er lead efter) **plus det udgangspunkt
  koden læste.** **Valgt.** Lead-reglen bor kun i `planBoardChange`; funktionen er sidste værn, ikke
  en kopi af planlægningen.

**Dobbelt-værnet for invarianterne**
Invarianterne (2-3 partnere, mindst én intern, præcis én lead, og lead er intern) afvises i
TypeScript FØR kaldet **og** håndhæves af funktionen på det færdige board.
- TypeScript først, fordi det giver de danske, præcise fejl uden at røre basen, og fordi de rene
  funktioner kan testes uden database.
- Funktionen som sidste værn, fordi de er invarianter på tværs af rækker og derfor ikke kan være
  DB-constraints (0010) — og fordi en kode-/data-uenighed (en forældet læsning af `is_internal`,
  en fremtidig tredje skrivevej, en SQL-konsol) ellers ville give et board der bryder reglerne
  uden at nogen opdager det. Funktionen tjekker det der faktisk ligger i tabellen efter skrivningen,
  ikke det koden *troede* den skrev. Pris: `MIN/MAX_BOARD_SIZE` står både i TypeScript (2, 3) og i
  SQL (2, 3). Det er strukturelle grænser fra byggespec §5.2, ikke et forretningstal; db-testen
  (`tests/db/board-composition-fn.test.ts`) fejler hvis de to sider driver fra hinanden.

**Samtidighed**
Funktionen tager `for update` på boardets række (to ændringer serialiseres) og sammenligner
udgangspunktet med de nuværende medlemmer; er de ikke ens, afvises planen med `40001`
(`serialization_failure`) og en dansk besked. Det er optimistisk samtidighedskontrol oven på
rækkelåsen: uden den ville den anden ændring vente på låsen og så skrive en plan bygget på et board
der ikke længere findes. Brugeren genindlæser og prøver igen.

**Revisionsrækken og Cal.com (B-66)**
Revisionsrækken skrives af funktionen i samme transaktion — en ændring uden spor kan ikke opstå
(det vender ADR 0062 §4's "skriv-fejl i sporet vælter ikke ændringen" for sammensætningsændringer;
`opdater_hosts` har ingen sammensætning at holde atomisk med og er stadig best-effort). Men
Cal.com-udfaldet kendes først bagefter, og synkroniseringen forbliver UDEN FOR transaktionen (en
ekstern leverandørs oppetid er ikke en betingelse for at rette et board). Derfor skrives rækken med
den **pessimistiske** værdi `calcom_sync = 'fejlet'` for handlinger der ændrer værterne og
`'sprunget_over'` for lead-markering; koden retter den til det faktiske udfald
(`settleBoardChangeSync`). Dør processen midt imellem, står sporet som "hosts hænger efter" i stedet
for at skjule en manglende synkronisering — fejl i den sikre retning. Ingen schema-ændring i
`board_change` var nødvendig.

**Sædeskift (B-67)**
- *A — kun en advarsel: "kør Opdatér hosts".* Det er hullet.
- *B — kør hosts-synkroniseringen automatisk* for hvert board partneren sidder på, efter sædet er
  gemt. **Valgt.** Samme kontrakt som ADR 0062: sædet står (Supabase er sandhedskilde), Cal.com-fejl
  bliver en værdi og en advarsel, aldrig et rollback.

**Indsigtsudtrækket (B-65)**
Samme afgrænsning som ADR 0053: kun data i Supabase, kun personens egne nøgler, aldrig en bred
læsning filtreret bagefter, ingen aktør-identitet for andre.

## Beslutning

1. **Migration 0026: `change_board_composition(...)`** — `security invoker`, plpgsql, revoked fra
   `public`/`anon`/`authenticated`. Tager rækkelås, afviser en forældet plan (`40001`), skriver
   indsæt/slet/lead-flyt, håndhæver invarianterne på det færdige board og skriver `board_change`
   — alt i ét kald. Returnerer revisionsrækkens id. `applyPlan` i
   `src/server/boards/composition.ts` er nu ét `rpc`-kald; `changeBoardComposition` tager aktøren.
2. **`setPartnerCalcomUserId` synkroniserer hosts** efter et faktisk sædeskift (uændret sæde rører
   ikke Cal.com): `syncHostsForPartner` (`meetings/board-hosts.ts`) kører `syncBoardHosts(…,
   { createIfMissing: false })` for hvert board partneren sidder på og logger `opdater_hosts` pr.
   rørt board (et board uden event type springes over og logges ikke), så advarslen på
   `/admin/boards` også dækker denne vej. Svaret bærer `warning` (nyt felt på `AuthFormState`, som
   `BoardActionState` har haft siden 0062). Fjernes sædet, fejler hosts-opdateringen højlydt og vises
   — et board kan ikke have en vært uden sæde.
3. **Indsigtsudtrækket** (`subject-collect.ts` / `subject-access.ts`):
   - `board_change`: top-niveau `board_aendringer_udfoert` (rækker hvor personen er `actor_id`,
     uanset rolle — også en admin uden ejer-/partnerprofil), `ejer.boards[].aendringer` (alle
     ændringer af ejerens boards, også admins) og `partner.board_aendringer_om_dig` (ændringer hvor
     partneren er `partner_id`/`replaced_partner_id`). En anden aktørs id udleveres aldrig — kun
     rollen (`udfoert_af_rolle`) og om det var personen selv (`udfoert_af_dig`).
   - `meeting_summary` → `ejer.boards[].moeder[].resume` (ejeren er RLS-ejer af resuméet, 0022).
   - `notification_delivery` → `beskeder_sendt_til_dig` (type, kanal, status, leverandørreference —
     aldrig teksten, den gemmes ikke).
   - `rating_link` → `vurderingslinks` (møde, rolle, udløb, brugt — aldrig tokenet, det gemmes ikke).
   - `afgraensning.ikke_inkluderet` er opdateret: "AI-resuméer … ikke gemt som data" er forældet;
     nu står transskripter/optagelser, beskedtekster og andre aktørers identitet.

## Konsekvenser

- Positive: en sammensætningsændring og dens spor lykkes eller fejler samlet; to samtidige redaktører
  kan ikke overskrive hinanden; en fremtidig tredje skrivevej til `board_partner` kan ikke bryde
  invarianterne uden at funktionen siger fra (så længe den går gennem funktionen); sædeskift
  efterlader ikke event typer med et gammelt sæde; indsigtsudtrækket dækker nu sporet og de tre
  nyere tabeller.
- Negative / pris: SQL og TypeScript kender begge 2-3 og "mindst én intern" (testet, ikke delt).
  Lead-reglen er bevidst ikke i SQL. En fejl i revisionsskrivningen vælter nu ændringen (tilsigtet).
  Sædeskift kan tage længere (ét Cal.com-kald pr. board). Ejeren/admin kan møde "Boardet blev ændret
  af en anden imens" og skal prøve igen.
- Opfølgning: sletter man en katalogpost helt, forsvinder partneren fra boardet via `on delete
  cascade` uden at hosts opdateres, og et board kan ende under to partnere uden at funktionen
  kaldes — der findes ingen sletteaction i appen endnu (GDPR-sletteflowet er en egen skive, ADR 0053),
  så det følger med den (backlog B-68). Indsigtsudtrækket mangler stadig en test der gennemgår schemaet
  og fejler på en uregistreret persontabel (ADR 0053's opfølgning).
