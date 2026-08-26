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
Bekræft at Cal.com (Platform managed users + Atoms) kan håndtere et møde med flere værter:
**2-3 partnere + ejer**, med EU-residens og — hvis muligt — native mødeoptagelse.

## Hvad skal verificeres
1. Multi-host-møde: 2-3 partnere som værter + ejer som deltager, via managed users/Atoms.
2. EU-residens på det valgte niveau (punkt 5).
3. Native optagelse på den valgte plan (punkt 6) — eller dokumentér at det mangler.
4. Webhook-flow: booking → vores domæne (meeting-entitet) — kobler til `BookingProvider`.

## Evalueringskriterier
| Kriterium | Resultat | Note | Vægt |
|---|---|---|---|
| 2-3 værter + ejer | | | skal-krav |
| EU-residens | | | skal-krav (punkt 5) |
| Native optagelse | | | ønske (punkt 6) |
| Webhook → domæne | | | vigtig |
| Plan/pris-binding | | | ejer/Mads beslutter |

## Kontofri forberedelse (gjort/kan gøres nu)
- `BookingProvider`/`VideoProvider`-porte findes allerede (stubs kaster `NotConfiguredError`).
- `MultiHostMeetingRequest` modellerer ejer + partner-værter + varighed.
- Den rigtige Cal.com-adapter udfyldes bag porten når plan/EU er afklaret.

## Beslutnings-gate
**STOP** ved plan/tier-valg (pris + dataresidens). Skriv multi-host-ADR med konklusion +
begrænsninger; udfyld derefter `BookingProvider`/`VideoProvider`.

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
| L-1 | **Multi-host:** 2-3 partnere som værter + ejer som deltager på ét event, via managed users mod ét delt event type | Kræver konto | `createMultiHostMeeting` (`src/lib/booking/calcom.ts`) |
| L-2 | **Værts-tildeling:** at `hosts: [{id}]` faktisk accepterer vores auth-bruger-id'er, eller at Cal.com kræver egne managed-user-id'er | Feltkontrakten er gættet ud fra API-dokumentationen | `createMultiHostMeeting`, `readBoardBookingInfo` |
| L-3 | **Join-URL-mapping:** `meetingUrl` vs. `metadata.videoCallUrl` på den valgte plan | Vi læser begge og falder tilbage til `""` — feltnavnet er uverificeret | `toScheduled`, `meeting.video_join_url` |
| L-4 | **Webhook-payloadens form:** feltnavnene `triggerEvent`, `payload.uid`, `payload.rescheduleUid`, `payload.startTime`, `payload.videoCallUrl` | Parseren afviser ukendt form med 200, så en forkert antagelse ville vise sig som "ingen webhooks virker" | `parseCalcomEvent`, `mapEventToMutation` |
| L-5 | **Signatur-header og -algoritme:** at headeren hedder `x-cal-signature-256` og er HMAC-SHA256 hex over rå body | Forkert antagelse = alle webhooks afvises med 401 (fail-closed, så sikkert — men dødt) | `verifyCalcomSignature` |
| L-6 | **Genlevering:** at Cal.com faktisk genleverer ved ikke-2xx, og hvor mange gange | ADR 0029's rollback bygger på at genlevering sker | `route.ts`, ADR 0029 |
| L-7 | **EU-residens** på det valgte niveau — og om `apiUrl` skal være `cal.eu` eller self-host | Plan-/tier-valg er STOP-gate | `CALCOM_API_URL`, `docs/gdpr/leverandoer-register.md` |
| L-8 | **Native mødeoptagelse** på valgt plan — eller dokumentér at det mangler | Ønske, ikke skal-krav. Optagelse må ikke bygges uden samtykkeflow (ejer) | ikke bygget |
| L-9 | **Reschedule-semantik:** at Cal.com udsteder en NY uid ved flytning, og sender den gamle som `rescheduleUid` | Hele reschedule-mapningen hviler på den antagelse | `mapEventToMutation` |

**Når checklisten køres:** skriv multi-host-ADR'en med konklusion + begrænsninger (den er
stadig udestående), kryds de tre DoD-punkter af i `docs/fase-2.md`, og opdatér
`docs/stub-register.md`.
