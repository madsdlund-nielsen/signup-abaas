# 0030 — Betalings-datamodel: versionerede prisregler + charge pr. afholdt møde

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 3
- **Berører uafklaret punkt:** ja — priser/moms/fejlet-træk-konsekvens flagges; besluttes ikke her

## Kontekst

Fase 3 skal bygge betalingsmekanikken uden tal: startpris, frekvensfaktorer og moms er
ejer-uafklarede (§12 pkt. 2/14), og betalingsmodellen er **træk pr. afholdt møde** —
*"ikke månedligt abonnement"* (§4). §6's datamodel har `memberships` og `pricing_rules`,
men **ingen opkrævningsentitet** — samtidig kræver §3 at kunden *"ser fakturaer"*, og
§5.9 at *"betaling gennemført/fejlet → opdaterer status"*. Nogen skal altså holde de
enkelte træk. Versionering af data findes heller ikke som mønster i repoet endnu.

## Overvejede muligheder

- **Opkrævninger:** egen `payment_charge`-tabel vs. status-felter på `meeting` vs. kun
  spejlet leverandørstatus på `membership` (spec'ens minimum — kan ikke vise fakturaer
  eller håndtere fejlede træk pr. møde).
- **Prisregler:** muterbar række (mister audit) vs. **append-only versioner**.
- **Prisen for en eksisterende aftale:** frys ved oprettelse vs. **følg den aktive regel**
  (§5.9: *"justeres … ved næste afholdelse"*).
- **Trækketidspunkt:** synkront i partner-registreringen vs. **afkoblet** grundlag + separat
  processering.

## Beslutning

Migration `0013_payment.sql`, fire tabeller (ental, RLS i samme fil, ingen write-policies):

- **`membership`** — én pr. board; frekvens (4/8/12, fra ejerens quiz-svar ved oprettelse),
  status, kortstatus, provider-referencer. Ejer + admin læser; **partnere ser aldrig
  betalingsdata**.
- **`pricing_rule`** — **append-only versioner**; højst én aktiv via partial unique index
  `(is_active) where is_active` (constrainten er mekanismen, som ved webhook-idempotens).
  Den aktive version er authed-læsbar (client-side live prisberegner, §5.9); alle
  versioner kun admin. **Ingen seed, ingen defaults** — findes ingen aktiv version,
  fejler beregningen højlydt. Formlen er mekanik:
  `meeting_fee = round((base + antal_partnere × per_partner) × faktor_for_frekvens)`.
- **`payment_charge`** — opkrævningsgrundlag pr. afholdt møde. `meeting_id unique`.
  Refererer den anvendte prisregel-version (audit). Status afventer/gennemført/fejlet +
  fejlårsag. Det er "fakturaerne" i §3.
- **`payment_webhook_event`** — idempotens + audit, spejl af `meeting_webhook_event`.

**Charge-flowet:**

1. Afholdelses-flippet i `registerMeetingStatus` fik `.select("id")` — **kun den
   registrering der faktisk flipper** planlagt→afholdt opretter grundlaget
   (idempotenslag 1; `meeting_id unique` er lag 2). Uden fixet ville N partneres
   registreringer give N forsøg.
2. Beløbet beregnes **på afholdelsestidspunktet** af den aktive regel × boardstørrelse ×
   membership-frekvens. Deraf: **op-/nedgradering og prisændringer slår igennem ved
   næste afholdelse — ingen proratering.** Der findes ingen forudbetaling at proratere;
   fase-3.md's tidligere prorateringskrav var abonnements-tænkning og er rettet.
3. Mangler membership eller aktiv prisregel: **ingen række + `captureException`** —
   hullet er synligt (afholdt møde uden opkrævning), og intet beløb gættes.
4. Selve provider-trækket er **afkoblet**: en admin-handling processerer afventende
   grundlag (stub → `NotConfiguredError`, rækken står ærligt som afventer); webhooken er
   autoritativ for gennemført/fejlet. Partnerens registrering afhænger aldrig af
   betalingsleverandøren.
5. **Fejlet træk rører aldrig honorar** — §5.10 udløser honorar på afholdt uafhængigt af
   betaling; konsekvensen af fejlet træk er ejer-uafklaret. `TODO(ejer)`.

## Konsekvenser

- **Positive:** fakturavisning og fejlhåndtering har en entitet; hver opkrævning kan
  revideres mod den prisregel-version der gjaldt; dobbelt-opkrævning er umulig på
  DB-niveau; prisregler kan forberedes som inaktive versioner og aktiveres i ét skridt.
- **Negative / pris:** aktivering er to skridt uden transaktion — fejler andet skridt,
  står systemet uden aktiv regel (beregning fejler højlydt) frem for med to; det er den
  rigtige fejlretning. Append-only versioner vokser (trivielt volumen).
- **Opfølgning:** fase 5's honorarberegning genbruger versioneringsmønstret for satser;
  "følger aftaler ny prisregel eller pinnes de?" står som `TODO(ejer)` — mekanikken
  understøtter begge.
