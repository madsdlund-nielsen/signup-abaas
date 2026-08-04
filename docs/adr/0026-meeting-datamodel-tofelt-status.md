# 0026 — Møde-datamodel: livscyklus og partner-registrering er to felter

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 2
- **Berører uafklaret punkt:** delvist — honorar ved udeblivelse/sent afbud, ændre/aflyse-vindue og note-synlighed flagges; besluttes ikke her

## Kontekst

Fase 2 skal give møder en datamodel. `docs/fase-2.md`s første udkast beskrev én
status-livscyklus ("planlagt → afholdt / aflyst / udeblevet"), men byggespec §5.6 siger
noget andet: *"Hver partner registrerer status pr. møde: **afholdt / forsinket afbud /
udeblivelse**"* — og §5.10 gør netop den registrering til honorargrundlaget: *"hver
deltagende partner optjener fuldt honorar pr. afholdt møde (status = afholdt)"*.

Det er to forskellige ting: **mødets tilstand i appen** (er det planlagt, aflyst, afholdt?)
og **partnerens indberetning** af hvad der skete (grundlaget for afregning i fase 5, hvor
"udeblivelse" er kundens udeblivelse — konsekvensen er ejer-uafklaret, §12 pkt. 13).
Én-felt-modellen ville blande dem sammen: en aflysning i kalenderen og en partners
honorarindberetning ville skrive til samme felt.

## Overvejede muligheder

- **A — to felter:** `meeting.status` (livscyklus) + `meeting_partner.registered_status`
  (partnerens registrering pr. møde, null indtil registreret).
- **B — ét felt med alle værdier** (planlagt/aflyst/afholdt/udeblevet/forsinket_afbud):
  kan ikke udtrykke at to partnere registrerer forskelligt, og webhook-aflysning ville
  kunne overskrive en honorarregistrering.
- **C — kun partner-registrering, ingen livscyklus:** UI'et kan så ikke skelne et planlagt
  møde fra et aflyst uden at aflede det af registreringer der endnu ikke findes.

## Beslutning

**A**, i migration `0012_meeting.sql`:

- `meeting.status` — enum `planlagt / aflyst / afholdt`. Appens og webhookens felt:
  aflysning (app eller Cal.com-webhook) sætter `aflyst`; en partners
  `afholdt`-registrering bekræfter mødet og flipper `planlagt → afholdt`. Øvrige
  registreringer rører **ikke** livscyklussen — hvad "udeblivelse" betyder for mødet og
  honoraret er ejerens beslutning.
- `meeting_partner.registered_status` — enum `afholdt / forsinket_afbud / udeblivelse`,
  null indtil partneren registrerer (+ `registered_at`). Én registrering pr. partner pr.
  møde (PK). **Kun registrering — ingen beregnet konsekvens** (`TODO(ejer)`).
- `meeting.duration_minutes` (60, fast i v1) + `prep_minutes` (15) — honorargrundlaget
  75 min findes som **felter**; beregning og sats hører til fase 5. Porten sender kun de
  60 min til Cal.com; forberedelsen er domænets, ikke kalenderens.
- `meeting.provider_booking_uid` (unique, null indtil booket) — reconciliation-nøglen for
  webhooks (ADR 0027). `video_join_url` udfyldes af bookingen (Cal Video, §5.5).
- `meeting_note` — én efter-møde-note pr. partner pr. møde. RLS-default er **restriktiv**:
  forfatter + boardets ejer + admin; boardets øvrige partnere ser den ikke
  (note-synlighed er ejer-uafklaret — udvidelsen er én policy, ikke en ombygning).
- RLS på alle tabeller i samme migration; partner-adgang via `is_partner_on_board`
  (ADR 0025). Ingen write-policies — writes via service-role bag rolle- + ejerskabstjek.

`docs/fase-2.md`s DoD-linje er rettet til to-felt-modellen (Mads' stående besked om at
tilpasse dokumenterne til repoet, 2026-08-03).

## Konsekvenser

- **Positive:** honorargrundlaget (fase 5) læser ét utvetydigt felt pr. partner pr. møde;
  webhook-aflysninger kan aldrig overskrive en honorarregistrering; to partnere kan
  registrere forskelligt (den ene nåede frem, den anden fik afbud).
- **Negative / pris:** to felter at holde mentalt adskilt; UI skal vise begge uden at
  forvirre. Koblingen "afholdt-registrering flipper livscyklus" er en pragmatisk regel der
  kan skulle justeres når ejer beslutter udeblivelses-konsekvensen.
- **Opfølgning:** fase 4 (rating pr. partner pr. møde) og fase 5 (honorar) bygger direkte
  på `meeting_partner`; `meeting_prep`/`meeting_summaries` (§6) kommer i fase 4.
