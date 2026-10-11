# 0052 — Partner-tilgængelighed: lokal vægurstid i Supabase, ingen ejer-læsning, "ikke angivet" = ubegrænset

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 5 (5.3)
- **Berører uafklaret punkt:** ja — hvad "ikke angivet" betyder for bookbarhed (ejer), og synk til
  Cal.com-schedules (Mads, afventer B-23/ADR 0046)

## Kontekst

Fase 5.3: partneren angiver hvornår vedkommende kan holde møder, og det skal respekteres når ejeren
booker/flytter og når lead-partneren initierer næste møde. Bygget skærm-først (ADR 0042):
`/partner/tilgaengelighed` er produktionskode fra første commit.

Fire valg lå i spil, og alle er svære at omgøre når der først ligger data:

1. **Hvor bor sandheden?** Cal.com har sine egne schedules, men adapteren omskrives netop til
   collective event types (B-23, ADR 0046), og der er ingen Teams-konto at verificere mod endnu.
2. **Hvordan gemmes tid?** Et ugevindue er ikke et tidspunkt. 09:00-12:00 mandag skal blive ved med
   at betyde 09-12 *dansk tid* gennem begge sommertidsskift.
3. **Hvem må læse hvad?** Fraværsrækken har en fritekstnote. En partner der skriver "syg" har
   afgivet en helbredsoplysning (GDPR art. 9) til en tabel som ejeren ellers ville kunne læse.
4. **Hvad betyder det at intet er angivet?** Før partnerne har udfyldt skemaet er der ingen data.

## Overvejede muligheder

- **Sandhed: Cal.com-schedules (A)** — ingen egen datamodel. Men booking-vagten ville afhænge af
  en adapter vi ikke kan køre, og arkitekturprincip 1 (Supabase er sandhedskilde) brydes.
  **Supabase (B)** — vagten kører i vores egen transaktionsgrænse og kan testes. Synk til Cal.com
  bliver et senere, envejs skridt.
- **Tid: `timestamptz`-intervaller (A)** — forkert for tilbagevendende vinduer; flytter sig en time
  to gange om året. **`time` + `date` i lokal vægurstid (B)** — det partneren faktisk mener.
  Oversættelsen til absolutte tidspunkter sker ét sted, i `algorithm.ts`.
- **Ejerlæsning: policy via board_partner → board.owner_id (A)** — mønsteret fra
  `partner_profile_select_board_owner`, nemt, men eksponerer noterne. **Ingen ejer-policy; booking-
  visningen beregnes server-side og afleverer kun fælles vinduer (B)**.
- **"Ikke angivet": ikke bookbar (A)** — booking brydes for alle der ikke har udfyldt, også i dag.
  **Ubegrænset (B)** — bryder intet, men en partner kan bookes selv om vedkommende aldrig har taget stilling.

## Beslutning

**B på alle fire.**

- **Tabeller (0018):** `partner_availability` (ISO-ugedag 1-7, `time`-start/slut, slut > start,
  unikt vindue pr. partner; `24:00` tilladt) og `partner_absence` (hele dage, begge ender
  inklusive, note ≤ 500 tegn). Delvist overlappende vinduer tillades og slås sammen af
  algoritmen — en exclusion constraint ville kræve `btree_gist` for en gevinst brugeren ikke mærker.
- **Tidszone:** alt lagres som lokal Europe/Copenhagen-vægurstid. `algorithm.ts` oversætter med
  `Intl.DateTimeFormat` (intet dato-bibliotek). Forårshullet rykker en vægurstid frem med hullets
  længde; efterårets dobbelte time dækkes af et vindue der omfatter den (start = tidligste,
  slut = seneste forekomst). Begge er enhedstestet.
- **RLS:** partneren læser egne rækker, admin alle. **Ingen policy for ejeren eller boardets øvrige
  partnere** — negativt testet (`tests/db/partner-availability-rls.test.ts`). Ingen write-policies;
  writes via service-role i `src/server/availability/actions.ts` bag "er det min partnerprofil".
  Ejerens bookingside får `getBoardCommonWindows`: service-role bag ejerskabstjek af boardet, der
  afleverer vinduer, et flag og navne — aldrig rækker eller noter.
- **Booking-vagt:** `assertBoardAvailable`/`assertMeetingBoardAvailable` i `guard.ts`, kaldt ét sted
  pr. flow i `meetings/actions.ts` (book + initiér deler `createMeetingForBoard`; flyt har sit eget
  kald). Tjekker 60 min mødetid, ikke de 15 betalte forberedelsesminutter. Afviser med
  "<navn> er ikke ledig …". En læsefejl kaster — vagten svarer aldrig "ledig" ved tvivl.
- **"Ikke angivet" = ingen begrænsning** (kun hvad angår ugevinduer; *fravær gælder altid*).
  Beslutnings-pladsholder, `isRestricted` i `algorithm.ts`, registreret i stub-registret.
  Partnerens egen skærm siger det højt ("Indtil du gør det, kan du bookes på alle tidspunkter").

## Konsekvenser

- Positive: skiven kan klikkes nu; vagten er testbar uden Cal.com; fraværsnoter kan ikke nå ejeren
  hverken ved en policy-fejl eller en glemt kolonne; tid er korrekt hele året.
- Negative / pris: tilgængelighed står kun i Supabase — Cal.com kender den ikke, så en booking der
  oprettes direkte hos Cal.com omgår vagten. `datetime-local`-input fortolkes stadig i serverens
  tidszone i `meetings/actions.ts` (B-29), så vagten kan afvise/acceptere en time forkert på en
  server uden for Europe/Copenhagen, indtil den rettes.
- Opfølgning:
  - TODO(ejer): skal "ikke angivet" betyde "ikke bookbar"? (stub-register).
  - TODO(mads): envejs synk partner_availability → Cal.com-schedules efter B-23 og med en Teams-konto
    (L-1/L-3…). Ikke bygget; Supabase forbliver sandheden.
  - `src/server/matching/index.ts` "Udskift viser hele puljen" er uændret: data findes nu, men
    "kalenderplads" er ikke defineret (hvor mange ledige timer? hvilken periode?) — stub-register.
  - Hvis ejeren senere skal læse ugevinduerne direkte, er det én policy i en ny migration.
