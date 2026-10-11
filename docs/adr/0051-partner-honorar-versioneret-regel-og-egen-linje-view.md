# 0051 — Partner-honorar: regel med gyldighedstidspunkt og en view der kun viser egne linjer

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 5 (5.1 + 5.2)
- **Berører uafklaret punkt:** ja — honorarsats (§12 pkt. 1), moms på partner-honorar (pkt. 14),
  honorar ved udeblivelse/sent afbud (pkt. 13), regnskabssystem (e-conomic vs. Dinero) og om
  udbetaling skal automatiseres. Ingen af dem er besluttet her; de er alle modelleret som
  konfiguration med en `ikke_fastlagt`-tilstand.

## Kontekst

Fase 5.1/5.2 kræver en honoraropgørelse pr. partner pr. afholdt møde med 75 min som grundlag
(60 min møde + 15 min betalt forberedelse, felterne findes siden 0012), en sats i admin der
aldrig står i kode, en opgørelse der ikke ændrer sig retroaktivt, en eksportgrænseflade — og
RLS-kravet "en partner må kun se eget honorar" (positiv **og** negativ case).

Bygget skærm-først (ADR 0042): `/partner/honorar` og `/admin/honorar` mod demo-data, derefter
logikken. Tre valg her er Spand A (datamodel, RLS-mønster) og skal dokumenteres.

## Beslutning

### 1. `fee_rule`: append-only versioner med `effective_from` — ikke `is_active`

Prisregler (0013) har ét `is_active`-flag og et partielt unikt indeks, så højst én version er
aktiv. Det passer til en pris, der gælder "nu" og som hver opkrævning peger på via
`payment_charge.pricing_rule_id` — den version der blev brugt gemmes på opkrævningen.

Honorar har ikke den gemte reference: **beløbet gemmes ikke**. Det beregnes ved læsning af
`partner_fee_line` (ren grundlagsdata) mod en regel. Med `is_active` ville en historisk opgørelse
ændre sig i det øjeblik admin aktiverer en ny version — præcis det §5.1 forbyder ("versionér
satser, så en historisk opgørelse ikke ændrer sig retroaktivt").

Derfor har hver version et `effective_from` (unikt), og **et møde afregnes efter den regel med
senest `effective_from <= meeting.starts_at`** (`selectFeeRule`, ren og deterministisk). Det giver:

- Historik er stabil uden at nogen skal "aktivere" noget — en ny version påvirker kun møder fra
  dens gyldighedstidspunkt og frem.
- To versioner kan ikke begge gælde for samme tidspunkt (`effective_from` er unik; valget er
  "senest").
- Intet snapshot pr. linje at holde i sync. Alternativet — en `fee_line`-tabel med gemt beløb og
  `fee_rule_id` — er forkastet nu: det kræver en skrivevej (hvornår oprettes linjen? ved
  registrering? ved afholdelse?) og en rettelsesproces når en registrering ændres, og begge dele
  hører til udbetalingen, som ikke er besluttet. Går vi til automatisk udbetaling, er det dér et
  snapshot skal tages.

Server-actionen afviser en ny version hvis den ligger før eller på den nyeste versions
`effective_from`, eller i fortiden (undtagen den allerførste, som skal kunne dække møder der
allerede er afholdt). Ellers kunne en "ny" version stadig ændre en opgørelse der allerede er
sendt videre. `datetime-local`-værdien fortolkes som dansk tid (`new Date(value)` ville bruge
serverens zone, UTC på Netlify, og forskyde med 1-2 timer).

`hourly_rate_minor` er øre pr. time, ikke pr. møde: satsen er uafhængig af mødets længde, og
`duration_minutes + prep_minutes` følger mødet. Formlen er
`round(sats × (duration + prep) / 60)`.

`vat_mode` og `absence_rule` er enums med `ikke_fastlagt` som **default** — den restriktive
tilstand er det der sker hvis ingen har besluttet noget. Satsen har ingen default og ingen seed.

### 2. `partner_fee_line`: en view med eksplicit filter, `security_invoker`

`meeting_partner`'s RLS (0012) lader en partner læse alle deltagere på mødets board, fordi
partnerportalen viser medpartnere. Honorar er den ene ting en partner ikke må se for andre, så
RLS på `meeting_partner` alene (og endnu mindre en ekstra kolonne dér) kan ikke bære kravet.

Viewen joiner `meeting_partner × meeting × partner_profile` og indeholder
`where pp.app_user_id = auth.uid() or has_role('admin')`. `with (security_invoker = true)` betyder
at underliggende RLS stadig gælder for kalderen — filteret indsnævrer kun. Ejere falder uden for
filteret: de må se deltagerlisten, men aldrig honorar. Viewen indeholder **grundlag, ikke beløb**
(test: ingen kolonne med `amount|rate|sats`), og `anon` har fået `revoke all` (ADR 0047).

Alternativer: (a) en SECURITY DEFINER-funktion pr. partner — ekstra eksponeret RPC-endpoint, mere
at vedligeholde, og ADR 0047 viser hvad den slags koster; (b) kun applikationsfilter i
`listMyFeeLines` — ville gøre RLS til andet lag for netop det krav RLS skal bære (arkitekturprincip
5). `listMyFeeLines` filtrerer *også* på `app_user_id`, så en bruger der både er admin og partner
ikke får alles honorar under "mit honorar" — men det er et supplement, ikke værnet.

`fee_rule` er læsbar for admin og partner/lead-partner (partneren skal kunne se hvilken sats og
hvilket gyldighedstidspunkt en opgørelse bygger på). Ingen write-policies; writes via
service-role bag `requireRole('admin')`.

### 3. Beregning som ren funktion med en diskrimineret union

`src/server/fees/algorithm.ts` har ingen Supabase-afhængighed. `computeFeeLine` returnerer
`beregnet | afventer_regel | ingen_sats | ikke_registreret | aflyst`. Et femte udfald (`aflyst`)
er tilføjet til de fire i designet: `meetingStatus` er input, og et aflyst møde har intet
honorargrundlag uanset registrering. En skærm kan dermed aldrig forveksle "0 kr" med "ikke
beregnet".

- Forsinket afbud/udeblivelse med `absence_rule = ikke_fastlagt` → `afventer_regel`: grundlaget er
  registreret, konsekvensen beregnes ikke. `intet_honorar` → beregnet 0; `fuldt_honorar` → fuldt.
  Registreringen `afholdt` flipper mødets livscyklus (ADR 0026); afbud/udeblivelse gør ikke, så
  de regnes på selve registreringen, ikke på mødestatus.
- **Moms:** `vatMode` videregives uændret og `ikke_fastlagt` er synligt i UI'et. Koden beregner
  aldrig en momssats — heller ikke når admin vælger `ekskl_moms`/`inkl_moms`; 25 % er ejerens/
  bogholderens anvendelse af reglen og ligger ikke i kode.
- Totaler summeres pr. valuta og momsmåder samles, så en periode hvor reglen skiftede ikke
  fremstår som ét tal med én momsbehandling.

### 4. Perioder i dansk tid; eksport som ren CSV

Perioden er en kalendermåned i `Europe/Copenhagen` (`monthPeriod`): et møde kl. 00:30 den 1. hører
til den nye måned, ikke UTC-måneden. Eksporten er en route handler
(`/admin/honorar/eksport?maaned=ÅÅÅÅ-MM&partner=…`) med et eksplicit admin-tjek, fordi route
handlers ligger uden for `/admin/layout.tsx`'s guard; RLS er andet lag. CSV følger RFC 4180 med
UTF-8 BOM (Excel) og neutraliserer formel-injektion i tekstceller. Beløb eksporteres som rå øre.
`src/lib/accounting/` er uberørt og forbliver stub — e-conomic vs. Dinero er ikke valgt, og en fil
er det bogholderen kan arbejde videre med uanset valget.

## Konsekvenser

- Positive: sats, moms og afbudsregel er konfiguration uden tal i kode; historik er stabil; "en
  partner ser kun eget honorar" er en egenskab ved læsevejen og testet med medpartner på samme
  board som den svære negative case; skærmene lover aldrig mere end de kan holde.
- Negative / pris: beløb gemmes ikke, så en eksporteret opgørelse er et øjebliksbillede af en
  beregning — ændres en registrering bagefter, ændrer genberegningen sig. Det er acceptabelt så
  længe udbetaling ikke er automatiseret; når den bliver, skal der tages et snapshot (se ovenfor).
  Beregningen sker i kode pr. visning (få rækker pr. periode).
- Opfølgning: `TODO(ejer)` på sats (§12 pkt. 1), moms (pkt. 14), udeblivelse (pkt. 13),
  regnskabssystem og udbetalingsautomatik — registreret i `docs/stub-register.md`. Demo-seed'et
  (ADR 0043) indsætter en åbenlyst falsk regel på 1 kr i timen kun hvor ingen regel findes. Demo-
  partnerne har ikke login, så `/partner/honorar` kan ikke ses med demodata; admin-opgørelsen kan.
  Partner-dashboardets honoraroverblik (fase 5.4) kan genbruge `listMyFeeLines` + `FeeFigures`.
