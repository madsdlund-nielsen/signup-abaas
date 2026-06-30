# Spike — Cal.com multi-host scheduling

> 🟡 SPIKE (Trin 9, arbejdspakke 0.5). Rører ⚠ punkt 5 + 6. **Verificér og dokumentér —
> beslut ikke.** STOP ved valg der binder Cal.com-plan/-tier (pris + dataresidens er
> ejer-/Mads-territorium). Forberedelse er kontofri; kørsel kræver en Cal.com-konto (afventer).

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
