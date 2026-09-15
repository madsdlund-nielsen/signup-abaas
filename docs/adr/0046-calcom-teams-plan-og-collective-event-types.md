# 0046 — Cal.com: Teams-plan og ét collective event type pr. board

- **Status:** Accepteret
- **Dato:** 2026-09-15
- **Fase:** 2 (retter en antagelse fase 2 blev bygget på)
- **Erstatter stack-valget i:** CLAUDE.md's tabelrække "Cal.com (Platform managed users + Atoms)"
- **Lukker:** L-2 i `docs/spikes/multi-host.md`
- **Berører uafklaret punkt:** ja — lukker plan-/tier-valget. EU-residens og native optagelse
  forbliver åbne (punkt 5 + 6)

## Kontekst

Fase 2 blev bygget mod en antagelse der stod i CLAUDE.md's låste stak-tabel siden fase 0:
**"Cal.com (Platform managed users + Atoms)"**. Antagelsen forplantede sig til
`src/lib/booking/port.ts`, til `docs/spikes/multi-host.md` (hvis formål er formuleret som
"via managed users/Atoms") og til selve adapterens felt-kontrakt i `src/lib/booking/calcom.ts`.

Adapteren blev skrevet uden konto. Spikens checkliste var eksplicit om hvad det kostede —
L-2: *"at `hosts: [{id}]` faktisk accepterer vores auth-bruger-id'er, eller at Cal.com kræver
egne managed-user-id'er. Feltkontrakten er gættet ud fra API-dokumentationen."*

To fund ved gennemgang af leverandørens egne kilder (2026-09-15) vælter antagelsen:

**1. Platform-planen kan ikke købes længere.** Cal.coms egen Platform-FAQ:

> "This is now deprecated and under maintenance for existing users only - no new customers
> can sign up for the platform plan"

Vi har ingen eksisterende Platform-konto, så vi er ikke omfattet af grandfathering. Managed
users + Atoms er dermed ikke en vej der står åben for os — uanset pris.

**2. `hosts` pr. booking findes ikke i API v2.** `POST /bookings` tager:

- `attendee` som **ét objekt** — `{ name, email, timeZone }`, altså kontaktoplysninger, ikke et
  bruger-id.
- **intet `hosts`-felt.** Værterne er en egenskab ved **event typen**, ikke ved bookingen.

Adapteren sender i dag begge dele forkert (`calcom.ts`):

```ts
attendees: [{ id: req.ownerUserId }],                    // plural + id — findes ikke
hosts: req.partnerUserIds.map((id) => ({ id })),         // feltet findes ikke
```

`ownerUserId` og `partnerUserIds` er desuden Supabase-auth-UUID'er (`board.owner_id` og
`partner_profile.app_user_id`, ADR 0025) — Cal.com kender dem ikke.

L-2 er dermed besvaret **uden konto**: feltkontrakten var gættet, og gættet var forkert.
Det er ikke en plan-begrænsning vi kan købe os ud af; designet "ét delt event type +
værter varieret pr. booking" kan ikke lade sig gøre på nogen plan.

## Overvejede muligheder

**Plan.** Cal.coms offentlige planer er Individual (gratis), **Teams $12/bruger/md**,
Organizations $28/bruger/md og Enterprise (tilbud) — 25% rabat ved årlig betaling.

- **Individual** — ingen team-event types, ingen collective. Udelukket.
- **Teams** — bærer **Collective events**, round-robin, managed events og **webhooks**.
  Det er præcis vores primitiver.
- **Organizations** — tilføjer kun *unlimited sub-teams* og *SAML SSO* oven i Teams. Vi har
  ét fladt rådgiverkorps og kører Supabase Auth (ADR 0013). Ingen af delene bruges.
- **Platform** — lukket for nye kunder (se kontekst).

**Booking-model.** Når værter hører til event typen og ikke til bookingen:

- **Ét delt event type, værter pr. booking** — det nuværende design. Umuligt i API v2.
- **Ét collective event type pr. board** — oprettes via team-event-type-endpointet med
  `schedulingType: "collective"` og boardets 2-3 partnere i `hosts`. Bookinger navngiver
  derefter bare det event type. **Valgt.**

## Beslutning

**1. Cal.com-planen er Teams** ($12/bruger/md). Sæder tælles i **rådgivere + admin** — ejere
og kunder er *attendees* med `{ name, email, timeZone }` og har aldrig en Cal.com-konto, så de
koster ingen sæder. Regningen følger dermed rådgiverkataloget, ikke omsætningen.

**2. Multi-host realiseres som ét collective team event type pr. board**, ikke som ét delt
event type med værter pr. booking.

Beslutningen er Mads' (2026-09-15) under den tekniske beslutningsret han har fået af ejerne.

## Konsekvenser

- **Positive:** planen er ~$12/rådgiver/md frem for et lukket produkt vi ikke kunne købe;
  `Collective events` er en dokumenteret, understøttet primitiv frem for en gættet felt-kontrakt;
  ejere og kunder koster ingen sæder; L-2 er lukket uden at vente på en konto.
- **Negative / pris — dette er rework af merget kode.** Konkret rammer det:
  - `src/lib/booking/calcom.ts` — `createMultiHostMeeting` sender to felter der ikke findes.
    `attendee` skal være ét objekt med ejerens navn/e-mail/tidszone.
  - `CALCOM_EVENT_TYPE_ID` er **én** env-variabel. Event typen er nu pr. board, så id'et er
    tilstand i Supabase (kolonne på `board`), ikke konfiguration. Kræver en migration.
  - `readBoardBookingInfo` (`src/server/meetings/actions.ts`) henter `owner_id` og
    `app_user_id`. Den skal i stedet hente ejerens **kontaktoplysninger** og partnernes
    **Cal.com-bruger-id'er**.
  - Partner-identitet får et **tredje** led: katalogpost ↔ auth-bruger (ADR 0025) ↔
    Cal.com-team-bruger. Sidstnævnte skal oprettes/inviteres og gemmes.
  - Boardets livscyklus får en ny sideeffekt: et nyt board skal oprette et event type, og en
    partnerudskiftning skal opdatere dets `hosts`.

  Arbejdet er **ikke** udført i denne ADR's PR: `FLAG_BOOKING` er slået fra og der er ingen
  Cal.com-nøgler, så modulet kan ikke booke noget. Sporet som `docs/backlog.md` **B-23**.
- **Åbent efter denne beslutning:**
  - ⚠ **EU-residens på Teams-planen** (punkt 5). Plan-valget svarer **ikke** på det. `apiUrl`
    er fortsat udskiftelig (`cal.eu`/self-host) i `readConfig`, men hvilket niveau der giver
    EU-residens er uverificeret. Dette er stadig en gate før produktionsdata.
  - ⚠ **Native mødeoptagelse på Teams-planen** (punkt 6) — uverificeret. Optagelse kræver
    desuden ejerens samtykkeflow, uændret.
  - Resten af `docs/spikes/multi-host.md`'s liveverifikations-checkliste (L-1, L-3, L-4, L-5)
    kræver stadig en konto.
