# Spike — Cal.com multi-host scheduling

> 🟡 SPIKE (Trin 9, arbejdspakke 0.5). Rører ⚠ punkt 5 + 6. **Verificér og dokumentér —
> beslut ikke.** STOP ved valg der binder Cal.com-plan/-tier (pris + dataresidens er
> ejer-/Mads-territorium). Forberedelse er kontofri; kørsel kræver en Cal.com-konto (afventer).
>
> **Gate-ændring (Mads, 2026-08-04):** spiken er ikke længere en *byggegate* for fase 2 —
> adapter, webhook-flow og UI bygges færdigt mod porten med stub aktiv, og spørgsmålene
> nedenfor besvares som **verifikation under byg** når Cal.com-nøglerne lander.
> **STOP-gaten ved plan-/tier-valg består uændret** — den er pris + dataresidens og
> dermed ejer-/Mads-territorium. ADR'en med spike-konklusionen skrives stadig når
> kørslen sker.

## Formål
Bekræft at Cal.com kan håndtere et møde med flere værter: **2-3 partnere + ejer**, med
EU-residens og — hvis muligt — native mødeoptagelse.

> **Præmis-rettelse (2026-09-15, ADR 0044).** Formålet stod oprindeligt som "via managed
> users/Atoms". Den vej findes ikke længere: **Platform-planen er deprecated og lukket for
> nye kunder.** Planen er nu **Teams**, og multi-host realiseres som **ét collective event
> type pr. board**. L-2 nedenfor er lukket som konsekvens.

## Hvad skal verificeres
1. Multi-host-møde: 2-3 partnere som værter + ejer som attendee, mod boardets collective event type.
2. EU-residens på det valgte niveau (punkt 5).
3. Native optagelse på den valgte plan (punkt 6) — eller dokumentér at det mangler.
4. Webhook-flow: booking → vores domæne (meeting-entitet) — kobler til `BookingProvider`.

## Evalueringskriterier
| Kriterium | Resultat | Note | Vægt |
|---|---|---|---|
| 2-3 værter + ejer | 🟡 model afklaret | Collective event type pr. board bærer det; selve kørslen kræver konto (L-1) | skal-krav |
| EU-residens | 🔴 åben | Teams-planen svarer ikke på det. `apiUrl` er fortsat udskiftelig (L-7) | skal-krav (punkt 5) |
| Native optagelse | 🔴 åben | Uverificeret på Teams (L-8). Kræver desuden samtykkeflow (ejer) | ønske (punkt 6) |
| Webhook → domæne | 🟡 bygget, uverificeret | Webhooks er med på Teams; payload-form + signatur er stadig gættet (L-4, L-5) | vigtig |
| Plan/pris-binding | ✅ **lukket** | **Teams, $12/bruger/md** (Mads, 2026-09-15; ADR 0044). Platform er lukket for nye kunder. Sæder = rådgivere + admin | ejer/Mads beslutter |

## Kontofri forberedelse (gjort/kan gøres nu)
- `BookingProvider`/`VideoProvider`-porte findes allerede (stubs kaster `NotConfiguredError`).
- `MultiHostMeetingRequest` modellerer ejer + partner-værter + varighed.
- Den rigtige Cal.com-adapter udfyldes bag porten når plan/EU er afklaret.

## Beslutnings-gate
~~**STOP** ved plan/tier-valg (pris + dataresidens).~~ → **Plan-delen er lukket: Teams**
(ADR 0044). **Dataresidens-delen består** — EU-residens på Teams er uverificeret (L-7) og er
fortsat en gate før der lægges produktionsdata ind.

---

## Liveverifikations-checkliste — GATE FØR PRODUKTION

> Tilføjet 2026-08-26 ved den betingede lukning af fase 2 (`docs/fase-2-rapport.md` §5).
> Fase 2's tre ikke-afkrydsede DoD-punkter er alle blokeret af samme årsag: ingen
> Cal.com-konto. De er samlet her, så de ikke ligger spredt som kommentarer.
>
> **Denne checkliste er en gate før produktion — ikke før fase 3.** Fase 3 må starte.
> Ingen af punkterne må krydses af på et skøn: enten er de kørt mod en rigtig konto,
> eller også står de åbne.

| # | Skal verificeres | Hvorfor det ikke kunne gøres nu | Rammer |
|---|---|---|---|
| L-1 | **Multi-host:** 2-3 partnere som værter + ejer som attendee på ét event, mod boardets **collective** team event type (ADR 0044) | Kræver konto | `createMultiHostMeeting` (`src/lib/booking/calcom.ts`) |
| ~~L-2~~ | ✅ **LUKKET 2026-09-15 uden konto** (ADR 0044). Svaret er "ingen af delene": `POST /bookings` har **intet `hosts`-felt** — værter hører til event typen — og `attendee` er **ét objekt** med `{name, email, timeZone}`, ikke et bruger-id. Gættet var forkert, og ingen plan kan købe os ud af det | Besvaret af leverandørens API-reference; krævede ingen konto | `createMultiHostMeeting`, `readBoardBookingInfo` → rework sporet som `docs/backlog.md` **B-23** |
| L-3 | **Join-URL-mapping:** `meetingUrl` vs. `metadata.videoCallUrl` på den valgte plan | Vi læser begge og falder tilbage til `""` — feltnavnet er uverificeret | `toScheduled`, `meeting.video_join_url` |
| L-4 | **Webhook-payloadens form:** feltnavnene `triggerEvent`, `payload.uid`, `payload.rescheduleUid`, `payload.startTime`, `payload.videoCallUrl` | Parseren afviser ukendt form med 200, så en forkert antagelse ville vise sig som "ingen webhooks virker" | `parseCalcomEvent`, `mapEventToMutation` |
| L-5 | **Signatur-header og -algoritme:** at headeren hedder `x-cal-signature-256` og er HMAC-SHA256 hex over rå body | Forkert antagelse = alle webhooks afvises med 401 (fail-closed, så sikkert — men dødt) | `verifyCalcomSignature` |
| L-6 | **Genlevering:** at Cal.com faktisk genleverer ved ikke-2xx, og hvor mange gange | ADR 0029's rollback bygger på at genlevering sker | `route.ts`, ADR 0029 |
| L-7 | **EU-residens** på **Teams** — og om `apiUrl` skal være `cal.eu` eller self-host | Plan-valget (ADR 0044) svarer **ikke** på dataresidens; den del af STOP-gaten består | `CALCOM_API_URL`, `docs/gdpr/leverandoer-register.md` |
| L-8 | **Native mødeoptagelse** på **Teams** — eller dokumentér at det mangler | Ønske, ikke skal-krav. Optagelse må ikke bygges uden samtykkeflow (ejer) | ikke bygget |
| L-9 | **Reschedule-semantik:** at Cal.com udsteder en NY uid ved flytning, og sender den gamle som `rescheduleUid` | Hele reschedule-mapningen hviler på den antagelse | `mapEventToMutation` |

**Når checklisten køres:** ADR 0044 dækker plan-valget og booking-modellen. Skriv en
opfølgende ADR med konklusionen på den faktiske kørsel (L-1, L-3 … L-9) + begrænsninger,
kryds de tre DoD-punkter af i `docs/fase-2.md`, og opdatér `docs/stub-register.md`.
