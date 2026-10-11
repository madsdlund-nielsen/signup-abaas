# 0062 — Admin styrer board-sammensætning: fælles invarianter, revisionsspor og Cal.com-hosts efter hver ændring

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 1 (board) + 2 (Cal.com) — lukker det åbne punkt i ADR 0046
- **Berører uafklaret punkt:** ja — lead-partner: tildelings- og rotationsregler (ejer). Intet nyt
  forretningstal, ingen ny pris eller leverandør.

## Kontekst

CLAUDE.md § Roller: *"Admin — styrer quiz, tags, priser, notifikationer, **board-sammensætning**."*
Siden fase 1.5 (ADR 0021/0022) kunne kun **ejeren** ændre sit board — `src/server/boards/actions.ts`
bag `requireRole('ejer')`. `/admin/boards` kunne kun sætte Cal.com-event typen. Tre ting fulgte med:

1. Admin kan ikke rette et board for en ejer (fx efter en aftale over telefonen), kun ejeren selv.
2. Ændrede ejeren sit board, blev Cal.com-event typens `hosts` aldrig opdateret (ADR 0046, "Åbent",
   `TODO(mads)` i `createBoardEventType`) — boardet kunne bookes mod forkerte værter.
3. Ingen kunne se *hvem* der havde ændret et board, og hvornår.

## Overvejede muligheder

**Hvor invarianterne bor, når to veje skriver samme tabel**
- *A — kopiér ejerens kode ind i en admin-action.* Hurtigt, men to steder at holde 2-3 partnere,
  mindst én intern og "lead er intern" i sync. Det er præcis den slags drift et revisionsspor
  ikke kan redde.
- *B — ét modul (`composition.ts`) som begge veje kalder.* Auth og ejerskab bliver hos den der
  kalder; invarianter, lead-regler og de skrivende trin bor ét sted. **Valgt.**

**Revisionsspor**
- *A — en analytics-hændelse (PostHog) uden persondata.* Ingen migration. Men PostHog er
  samtykkestyret og er ikke sandhedskilde: en ændring af hvem der sidder på boardet ændrer hvad
  ejeren betaler, hvem der ser ejerens behov (leadet) og hvem der bookes mod. Det er forretningsdata
  (arkitekturprincip 1), og et spor der kan mangle, fordi en besøgende afviste cookies, er ikke et spor.
- *B — tabellen `board_change` (migration 0025).* **Valgt.** Den bærer også udfaldet af Cal.com-
  synkroniseringen, så "hosts hænger efter" kan *aflæses* frem for gættes — det alene gør den
  nødvendig, ikke kun nyttig.

**Cal.com-hosts efter en ændring**
- *A — rul ændringen tilbage hvis Cal.com fejler.* Gør en ekstern leverandørs oppetid til en
  betingelse for at admin kan rette et board, og brækker "Supabase er sandhedskilde".
- *B — ændringen står; fejlen bliver en værdi, en advarsel og en række i sporet.* **Valgt.**
  Admin kører "Opdatér hosts" (idempotent).

**Hvad der vises for ejeren, når hosts ikke blev opdateret**
Intet. Ejeren kan ikke gøre noget ved det og skal ikke møde "Cal.com". Fejlen står på sporet og som
"Hosts hænger efter" på admins overblik.

## Beslutning

**1. Fælles modul `src/server/boards/composition.ts`** (ingen `"use server"`). Det ejer
`assertBoardShape`, `readInternalFlags`, de rene planlægningsfunktioner (`nextPartnerIds`,
`planBoardChange`) og de skrivende trin. Ejerens `actions.ts` er skrevet om til tynde wrappers
(auth, ejerskab, redirect); admins `admin-actions.ts` er samme tykkelse med `requireRole('admin')`.
Invarianter, ens for begge veje:

- 2-3 partnere, ingen dubletter, mindst én intern;
- lead er altid en intern partner på boardet, og der er præcis én;
- fjern/udskift af lead: nuværende lead består hvis vedkommende er intern og stadig på boardet, ellers
  overtager den indkommende (hvis intern), ellers den første interne.

En afvist ændring skriver intet: planen laves og valideres før første write. Rækkefølgen af
writes (indsæt → slet → flyt lead) sikrer at boardet aldrig er mindre end før. Det er ikke én
transaktion — se B-66. **Opdatering (ADR 0064):** skrivningen er nu én transaktion (migration 0026), og
revisionsrækken skrives i den. Ejerens `setBoardLead` slettede før i denne version lead'en *før* den
tjekkede at den nye sad på boardet; nu valideres det først.

**2. Admin-flade.** `/admin/boards` er et overblik (ejer, partnere med intern/ekstern/lead, antal
møder, medlemskabsstatus, Cal.com-status). `/admin/boards/[id]` er editoren: partnerne, tilføj,
fjern, udskift, lead, ejerens kompetencebehov mod dækning (`computeBoardCoverage`, ADR 0055) og
et kandidat-delta pr. udskiftning (`computeSwapDelta`, ADR 0022 — samme funktion som ejerens
infobar). "Udskift" er en server-rendret to-trins-flade (`?udskift=<partner>`), uden klient-JS.
Lead er altid *synlig* for admin (lead ser ejerens behov, ADR 0055 — det skal admin kunne se), men
knappen "Gør til lead" ligger bag flaget `leadPartner`, som på ejerens side.
`TODO(ejer): lead-partner regler`.

**3. Læsevejen** (`src/server/boards/admin.ts`) bruger service-role bag `requireRole('admin')`,
fordi overblikket samler på tværs af tabeller admin ikke har RLS-adgang til: ejerens navn/e-mail
(`app_user` kan kun læses af brugeren selv, 0006) og ejerens quiz-behov. Behovene læses via
`readOwnerTagIds` (`matching/owner-needs.ts`), som nu også bruges af lead-dashboardet (ADR 0055) —
kun tag-id'er forlader den, aldrig `free_text`. Samme begrundelse som ADR 0055 valg C.

**4. `board_change` (migration 0025).** Én række pr. ændring: `board_id`, `actor_id`
(`on delete set null`), `actor_role` (`ejer`/`admin`), `action`
(`tilfoej`/`fjern`/`udskift`/`saet_lead`/`opdater_hosts`), `partner_id` og `replaced_partner_id`
(begge `on delete set null`), `calcom_sync` (`opdateret`/`fejlet`/`sprunget_over`), `created_at`.
RLS (ADR 0007): **kun admin læser**, ingen write-policies — rækker skrives af service-role bag
rolletjekket. Ingen navne, e-mails eller fritekst; rækken overlever en slettet bruger/katalogpost
som anonym historik og følger boardet ved sletning. Skriv-fejl i sporet vælter ikke ændringen
(den er allerede sket); den logges uden persondata. Ejerens ændringer logges også — ellers ville
sporet kun vise admins halvdel af historien.

**5. Cal.com-hosts.** `syncBoardHosts` (`meetings/board-hosts.ts`) er den tidligere kerne af
`createBoardEventType`, løftet ud så to veje deler den: admins knap "Opret/Opdatér" og den
automatiske opdatering efter hver ændring (`createIfMissing: false` — et board uden event type
springes over). **Den kaster aldrig**; udfaldet er en værdi (`opdateret`/`sprunget_over`/`fejlet`).
Demo-tilstand springes over og gemmer aldrig det falske id (ADR 0041). Lead-markering ændrer ikke
værterne og kalder ikke Cal.com. `hostsOutOfSync` (rent) udleder "hænger efter" af sporet: den
*seneste* handling der rørte Cal.com fejlede — en senere vellykket "Opdatér hosts" ophæver den.

## Konsekvenser

- Admin og ejer kan ikke længere komme ud af sync om hvad et gyldigt board er. Ejerens flow er
  uændret udadtil (samme redirects, samme fejlbeskeder), men ejeren får nu også opdateret
  Cal.com-hosts, hvilket lukker ADR 0046's åbne punkt. Rest: en ændret `calcom_user_id` (B-67, lukket af ADR 0064).
- `listAdminBoards`/`AdminBoardRow` (kun Cal.com-status) er erstattet af `listAdminBoardOverviews`.
- Priseffekt: en ændring slår igennem i abonnementet ved næste periode (ADR 0056) — admins editor
  siger det, men viser intet beløb (pris er uafklaret, CLAUDE.md).
- Nye backlog-punkter: B-65 (indsigtsudtrækket), B-66 (ikke atomisk), B-67 (Cal.com-sæde ændres) —
  alle tre lukket af ADR 0064.
- Uændret uafklaret: lead-tildeling og -rotation, tie-break ved lige gode kandidater (admins
  kandidatliste rangordner ikke), board-livscyklus.
