# Fase 2 — rapport: leverancer, kodegennemgang og betinget lukning

> Hvad fase 2 leverede, hvad der er verificeret, hvad kodegennemgangen fandt — og,
> vigtigst, **hvorfor fasen lukkes betinget** og præcis hvad der udestår til
> liveverifikation. Samme formål som `docs/fase-0-rapport.md` og `docs/fase-1-rapport.md`:
> de åbne punkter skal ligge samlet, ikke spredt i kommentarer.
>
> Lukket (betinget) 2026-08-26.

## 1. Hvad Fase 2 leverede (🟢)

| Arbejdspakke | Leverance |
|---|---|
| **2.8 Partner-login** (bygget først) | Migration `0011`: `partner_profile.app_user_id`, `is_partner_on_board()` (SECURITY DEFINER, jf. byggespec §6), genoplivet `board_select_partner` + partner-read-policies. `src/server/partners` (invitation, portal-læsning, self-service uden tags). Lukker regressionen fra ADR 0021, hvor partnere ikke kunne se deres eget board. |
| **2.1 Cal.com-adapter** | `CalComBookingProvider` (API v2, rå `fetch`, ingen SDK-dependency). Repoets første ægte adapter bag en port. Cal.com-typer lækker ikke ud af filen. |
| **2.2 Multi-host booking** | `createMultiHostMeeting` modellerer ejer som deltager + 2-3 partnere som værter. Bygget mod porten med stub aktiv. |
| **2.3 Webhooks** | `POST /api/webhooks/calcom` — repoets første route handler. Signatur før alt (HMAC-SHA256, konstant-tid), idempotens via `meeting_webhook_event`, mutationer via `provider_booking_uid`. Webhooks **opretter** aldrig møder — Supabase er sandhedskilde. |
| **2.4 Datamodel** | Migration `0012`: `meeting` (60 + 15 min prep = honorargrundlag), `meeting_partner`, `meeting_note`, `meeting_webhook_event`. RLS i samme migration (ADR 0007). |
| **2.5 Cal Video** | Videolink kommer fra bookingen (Cal.com opretter Cal Video-rummet) → `meeting.video_join_url` → vist for deltagere i både `/moeder` og `/partner`. |
| **2.6 Booking-UI** | `/moeder`: ejer booker, flytter, aflyser. `/partner`: lead initierer næste møde. |
| **2.7 Status & noter** | To-felt-status (ADR 0026): mødets livscyklus + partnerens registrering pr. møde. Efter-møde-noter med restriktiv RLS-default. |

## 2. Verifikation

| Gate | Status |
|---|---|
| `npm run lint` (nu hele repoet, ADR 0028) | 🟢 |
| `npm run check` (`tsc`, nu med `noUncheckedIndexedAccess`) | 🟢 |
| `npm run build` | 🟢 |
| `npm run test:coverage` (unit + dækningstærskel) | 🟢 91 tests, 70,7 % |
| `npm run test:integration` | 🟢 24 tests |
| `npm run test:db` (RLS, positive **og** negative) | 🟢 i CI — **kan ikke køres lokalt**, Docker mangler (`docs/backlog.md` B-13) |

RLS-dækningen er reel og ikke kosmetisk: negative tests findes for fremmed ejer, ukoblet
partner, manglende session, skrivning uden for service-role, partner der prøver at redigere
egne tags, og partner der prøver at se puljen uden for eget board.

## 3. 🔴 FLAG — uafklarede punkter rørt i Fase 2

Alle markeret i kode med `// TODO(ejer):` / `// TODO(mads):` og registreret i
`docs/stub-register.md`. Ingen af dem er besluttet her.

| Punkt | Hvor | Status |
|---|---|---|
| Ændre-/aflyse-vindue inden møde | `src/server/meetings/actions.ts`, `0012_meeting.sql` | **Intet vindue håndhæves** — ejeren kan flytte/aflyse frit. Reglen tilføjes som konfiguration. |
| Note-synlighed | `0012_meeting.sql` (meeting_note-RLS) | Restriktiv default: forfatter + board-ejer + admin. Boardets øvrige partnere ser den ikke. Udvidelse er én policy. |
| Honorar ved udeblivelse/sent afbud | `src/server/meetings/actions.ts` | Kun registrering, ingen beregnet konsekvens. Fase 5 beregner når reglen findes. |
| Samtykke til mødeoptagelse | — | **Optagelse er ikke bygget.** Kræver både plan-afklaring og samtykkeflow. |
| Noter under møde | — | Ikke bygget; modulet er uafklaret. |
| Board-livscyklus | `0012_meeting.sql` | `meeting` er holdt livscyklus-agnostisk. |
| Lead-partner: tildelings-/rotationsregler | `src/server/meetings/actions.ts` (`initiateNextMeeting`) | `is_lead`-data bruges som den er (default: første interne partner). Manuel markering ligger bag flaget `leadPartner` (OFF). |

## 4. Fund undervejs — kodegennemgang

Fase 2 kom ind i én commit (`787ac43`, merge-økonomi) og var aldrig gennemgået for
korrekthed. Grøn suite ≠ gennemgået. Gennemgangen ved lukning fandt tre reelle fejl —
alle rettet i denne PR, ingen af dem fanget af den eksisterende suite.

**🔴 1. Webhook-events kunne gå tabt for altid.** Idempotensrækken blev skrevet før
mutationen; fejlede mutationen, svarede handleren `500`, og Cal.coms genlevering ramte
unique-constrainten og kvitterede `200 — allerede behandlet` **uden nogensinde at have
anvendt eventet**. En aflysning foretaget i Cal.com ville stille forsvinde, og
sandhedskilden divergere. Rettet: rækken rulles tilbage før `500`. Se **ADR 0029** — mønstret
arves af Alunta i fase 3, så fejlen måtte ikke kopieres videre. Regressionstests tilføjet.

**🔴 2. Ukontrolleret fejl ved påhægtning af bookingreferencen.** I `createMeetingForBoard`
blev `update`-kaldet der skriver `provider_booking_uid` aldrig fejltjekket. Fejlede det,
eksisterede bookingen hos Cal.com uden at Supabase kendte dens uid — og alle fremtidige
webhooks for den ville ryge i "ukendt uid → ignoreret". Stille divergens.
Rettet: fejlen tjekkes, bookingen kompenseres hos provideren, og mødet slettes.

**🟠 3. Værter kunne udelades i stilhed.** Boardets partnere blev oversat til
Cal.com-værter via `partner_profile.app_user_id`, og partnere **uden** auth-kobling blev
filtreret bort — mens `meeting_partner` stadig registrerede dem alle. Et board med 3
partnere kunne dermed booke et møde med 2 værter, og se komplet ud i appen. Særlig relevant
netop nu, hvor partner-invitation først kom med 2.8, så ukoblede partnere er den normale
tilstand. Rettet: bookingen fejler højlydt med besked om at invitere partnerne først —
jf. `docs/stub-politik.md` (fejl højlydt frem for at gætte stille).

**Mindre, ikke rettet** (noteret, ikke værd at røre nu):
- `CalComBookingProvider.toScheduled` falder tilbage til `joinUrl: ""` når hverken
  `meetingUrl` eller `metadata.videoCallUrl` findes. Tom streng er en stille pladsholder;
  feltmappingen afklares alligevel i liveverifikationen.
- `registerMeetingStatus` og `saveMeetingNote` kaster i stedet for at returnere
  `AuthFormState` som de øvrige actions, så fejl rammer error-boundary frem for
  formularen. Kosmetisk inkonsistens, ingen korrekthedsfejl.
- `src/lib/video/` er en tom skal (`// return new CalVideoProvider(config)`): videolinket
  kommer i praksis fra **booking**-adapteren. Porten er spekulativ indtil optagelse eller
  et brandet videolag bliver aktuelt.

## 5. Betinget lukning — hvad det betyder

`CLAUDE.md` siger at en fase ikke startes før den foregående er grøn. Fase 2's DoD kan
**ikke** blive helt grøn uden Cal.com-nøgler, og nøglerne er blokeret af et plan-/tier-valg
der er en STOP-gate (pris + dataresidens = ejer/Mads). At holde fasen åben ville derfor
blokere fase 3–6 på en beslutning der ikke er teknisk.

Præcedensen er sat: Mads fjernede byggegaten på multi-host-spiken 2026-08-04, netop så
fase 2 kunne bygges mod porten med stub aktiv.

**Fase 2 lukkes derfor betinget:** alt der kan verificeres uden en Cal.com-konto ER
verificeret, og resten er samlet i én checkliste der er en **gate før produktion**, ikke
før fase 3. Checklisten står i `docs/spikes/multi-host.md`.

Konkret udestår kun tre DoD-punkter, alle af samme årsag (ingen nøgler):
multi-host mod en rigtig konto, webhook-payloadens faktiske form/signatur-header, og
Cal Video-linkets feltmapping + EU-residens på valgt plan.

## 6. Blokerer produktion — ejer/Mads

Uændret fra fase 0/1, plus fase 2's egne:

- **Cal.com plan-/tier-valg** (pris + EU-residens) — STOP-gate. Alt Cal.com-vendt afhænger af den.
- **Netlify Functions-region = EU (Ireland)** — skal sættes i UI'et før rigtige persondata (`netlify.toml`).
- **Ordbogen-DPA** (ADR 0024) og øvrige DPA'er — `docs/gdpr/leverandoer-register.md`
  (som stadig navngiver afløste leverandører, `docs/backlog.md` B-01).
- **Samtykke til mødeoptagelse** — optagelse er ikke bygget og må ikke bygges uden beslutning.

## 7. Næste skridt — Fase 3

Fase 3 (betaling) kan starte. To ting skal ske **før** kode skrives:

1. **B-01 + B-03 + B-04** i `docs/backlog.md` — leverandørregister, `.env.example` og
   accounts-tjeklisten navngiver stadig Stripe/Anthropic. Fase 3 er præcis den fase der
   ellers ville bygge videre på det forkerte navn.
2. **B-08** — `src/lib/payments/` er stadig Stripe-formet. ADR 0023 valgte Alunta.

Og fra denne fase: **ADR 0029's idempotens-mønster gælder Alunta-webhooken.** Et tabt
betalings-event er dyrere end et tabt booking-event.
