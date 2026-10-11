# GDPR — sletteflow (art. 17, data-subject erasure)

> Bygget i skive Q (ADR 0068); modstykket til indsigtsudtrækket (art. 15, ADR 0053). Flowet findes på
> `/admin/juridisk` → «Sletning (art. 17)» og er **admin-udløst**: en admin slår en person op på e-mail, ser planen
> og bekræfter. Selvbetjent sletning (en ejer sletter sin egen konto) er ikke bygget.
> **Opbevaringspligt (🔴 ejer/jura) og slette-SLA (🔴 ejer) er IKKE afgjort** — flowet er derfor fail-closed:
> en person med betalingsdata kan ikke slettes af det.

## Princip

Sletning starter i **Supabase** (sandhedskilden) og fanner ud til eksterne behandlere via **porte** i
`src/lib/erasure/`. Supabase-delen er **én transaktion**; en ekstern behandlers fejl ruller den ikke tilbage, men
registreres som «mangler» på kvitteringen. Flowet er **idempotent** og efterlader en **kvittering uden persondata**.

## Flowet

1. **Slå op** (`previewErasure`): admin skriver e-mailen. Rollen læses fra sessionen; service-role bygges først efter
   admin-tjekket. Svaret er **planen** (`planErasure`) — der er intet skrevet endnu.
2. **Planen** viser:
   - hvad der **slettes** i Supabase (optalt) og hvad der **anonymiseres** (aktør nulstilles i `board_change`),
   - hvad der **blokerer** (se nedenfor) — en blokeret plan har ingen bekræftelsesknap,
   - hvilke boards en partner **fjernes fra** (med revisionsspor) og
   - hvilke **eksterne behandlere** der får besked, automatisk eller manuelt.
3. **Bekræft** (`confirmErasure`): admin skriver e-mailen igen; den skal matche kontoen. Derefter:
   1. planen genberegnes — blokeringer afviser *før* noget skrives;
   2. **`erase_data_subject`** (migration 0028) sletter alt i Supabase i én transaktion;
   3. **Cal.com** opdateres (hosts + kommende bookinger);
   4. **PostHog** og **Resend** via `eraseDataSubject`;
   5. **Supabase Auth** (`auth.admin.deleteUser`) og kontoankeret — kun hvis hverken PostHog eller Resend fejlede;
   6. **kvittering** skrives i `erasure_receipt`.

## Hvad der blokerer (fail-closed)

| Blokering | Hvorfor | Hvad der skal ske |
|---|---|---|
| **Betalingsdata:** `membership`/`payment_charge` på et board personen ejer | 🔴 Opbevaringspligt (bogføring/betaling) er ikke afklaret — «Afventer afklaring af opbevaringspligt (TODO(ejer/jura))» | Ejer/jura definerer opbevaringsperioder og hvad der må anonymiseres |
| **Honorargrundlag:** `meeting_partner.registered_status` på personens møder (som ejer: på boardet; som partner: partnerens egne) | Honorar er bogføringsbærende; en sletning ville fjerne grundlaget for en udbetaling | Som ovenfor |
| **Boardets invarianter (B-68):** partnerens fjernelse efterlader et board under 2 partnere, uden intern, eller uden lead | `board_partner` cascader ellers stille; boardet skal holde 2-3 / ≥ 1 intern / præcis én lead | Admin udskifter partneren på boardet først (`/admin/boards/[id]`), derefter prøves igen. Skærmen nævner boardene |
| **Selv:** en admin kan ikke slette sig selv | Ellers kunne den eneste admin låse platformen | En anden admin gør det |
| **Sidste admin** | Ingen kunne administrere platformen | Giv en anden admin-rollen først |

`erase_data_subject` gentager opbevaringspligt, selvsletning og sidste admin som **sidste værn** (et medlemskab kan
opstå mellem plan og udførelse), og `change_board_composition` (0026) håndhæver boardets invarianter på det færdige board.

## Hvad der slettes i Supabase

`app_user` er anker for resten. Funktionen sletter eksplicit de rækker der hænger på brugeren, og lader
`on delete cascade` tage resten:

| Gruppe | Tabeller |
|---|---|
| Konto | `user_role_assignment`, navn og telefon på `app_user` blankeres (e-mail beholdes som anker, se nedenfor) |
| Ejer | `board` (ejet) → cascade: `board_partner`, `meeting` (→ `meeting_partner`, `meeting_note`, `meeting_agenda_item`, `meeting_prep_note`, `meeting_summary`, `meeting_rating`, `rating_link`), `membership` (blokeret hvis den findes), `board_change` på boardet |
| Ejer | `quiz_answer`, `meeting_rating` (afgivet), `rating_link`, `notification_delivery` |
| Partner | `partner_profile` → cascade: tags, `partner_availability`, `partner_absence` (fraværsnoten kan være helbredsoplysninger, ADR 0052), `meeting_partner`, `meeting_note`, `meeting_prep_note`, `meeting_rating` (afgivet **og modtaget**), `rating_link` |
| Partner | `board_partner` fjernes først via `change_board_composition` (spor i `board_change`, `partner_id` nulstilles når profilen slettes) |
| Anonymiseres | `board_change.actor_id` og `notification_template.published_by` sættes til null; rækkerne består som anonym historik |

`tests/db/erasure.test.ts` låser listen af fremmednøgler til `app_user` og `partner_profile` fast — en ny tabel med
persondata får testen til at fejle, så sletningen udvides bevidst.

**Kontoankeret.** `app_user`-rækken (id + e-mail) beholdes blankeret til Auth-sletningen er gennemført. Så kan en
genkørsel finde personen igen hvis PostHog eller Resend fejlede (id og e-mail er deres opslagsnøgler). Triggeren fra
migration 0004 fjerner ankeret når `auth.users`-rækken slettes.

## Eksterne behandlere

Rigtig implementering **kun hvor API'et er dokumenteret** (ADR 0068). Resten er manuelle huller, der står på hver kvittering.

| Leverandør | Hvad sker der | Status |
|---|---|---|
| PostHog (EU) | Person + hændelser + optagelser slettes: opslag via HogQL (`person_distinct_ids`), så `DELETE /api/projects/:id/persons/:uuid/?delete_events=true&delete_recordings=true` (distinct-id = bruger-id) | ✅ adapter (`src/lib/erasure/posthog.ts`); aldrig kørt mod en konto — TODO(mads): scope `person:write`. Appen kalder ikke `identify` endnu, så en person er normalt «intet at slette» |
| Resend (EU, Dublin) | Kontakt slettes: `DELETE /contacts/{e-mail}`; 404 = intet at slette | ✅ adapter (`resend.ts`); vi opretter ikke kontakter. Mailloggen ligger hos Resend efter deres retention og kan ikke slettes via API — note på kvitteringen |
| Cal.com | **Partner:** boardets hosts opdateres (`syncBoardHosts`) og revisionsrækken rettes. **Ejer:** kommende bookinger aflyses (`cancelMeeting`). Attendee-data på tidligere bookinger og partnerens team-sæde: **manuelt** | Hosts/aflysning bruger den eksisterende booking-port; resten har ingen verificeret API (ADR 0046). Fejl ruller ikke tilbage og kan ikke genkøres (møderne er væk) — rettes i Cal.com / «Opdatér hosts» |
| Cal Video | Optagelser knyttet til personens møder | 🔴 optagelse er ikke bygget (L-8); intet at slette endnu |
| Ordbogen (LLM, transskription) | Resuméer slettes i Supabase. Transskript/lyd gemmes ikke hos os; verificér stateless-antagelsen hos leverandøren | **Manuelt** (vises kun når personen har resuméer) |
| inMobile | Telefonnummer og beskedlog slettes | **Manuelt** (vises kun når personen har et nummer) — ingen verificeret API |
| Alunta, QuickPay, Nets | — | **Slettes aldrig af flowet.** En person med data dér har betalingsdata og er blokeret (opbevaringspligt, TODO(ejer/jura)) |
| e-conomic / Dinero | — | **Slet IKKE** bogførte bilag (lovpligtig opbevaring). Ikke koblet på endnu (stub) |

Stub-adapteren kaster `NotConfiguredError` og kvitteres som **«Ikke konfigureret»** — et synligt hul, aldrig en
gennemført sletning. Demo-adapteren kvitterer `DEMO-ERASE-…`. Rigtige nøgler vinder altid over demo.

## Kvittering (`erasure_receipt`, migration 0028)

Kun: pseudonymt **id-hash** (SHA-256 af bruger-id'et), tidspunkt, udførende admin, **udfald** (`gennemfoert` | `delvist`),
**systemer** (`system`, `status`, fast `detail`-tekst) og **mangler** (systemer der ikke er slettet automatisk: fejlet,
ikke konfigureret, manuelt, udsat). **Ingen persondata** — fejltekster fra leverandører skrubbes. RLS: kun admin læser;
ingen write-policies (service-role skriver). Vises på `/admin/juridisk` (seneste 10).

- `gennemfoert`: Supabase og Supabase Auth er slettet. `mangler` kan stadig indeholde manuelle punkter.
- `delvist`: Supabase-dataene er slettet, men PostHog/Resend/Auth fejlede; kontoen står blankeret (kun e-mail). Slå
  personen op igen og bekræft — flowet er idempotent og gentager de eksterne skridt.

## Idempotens

- Er kontoen væk → «ingen konto» (intet kaldes). Dette er også svaret på en dobbelt-bekræftelse.
- Står kontoen blankeret tilbage → `erase_data_subject` finder intet at slette, de eksterne skridt gentages, en ny
  kvittering skrives.
- `change_board_composition` låser boardet og afviser en forældet plan (`40001`); to samtidige sletninger af samme
  person serialiseres på `app_user`-rækken.

## Afhængigheder (🔴 flag — beslut ikke)

- **TODO(ejer/jura): opbevaringspligt vs. sletning.** Bogføring (e-conomic/Dinero), betalingsdata
  (Alunta/QuickPay/**Nets**) og honorargrundlag kan være underlagt lovkrav der overstyrer sletning. Indløser-leddet
  er det strammeste. Indtil det er afklaret, blokerer flowet — og hvad der kan **anonymiseres** frem for slettes (fx
  `membership` uden persondata) er ikke afgjort. Det gælder også **modtagne vurderinger om en partner** (slettes i dag
  med katalogposten, jf. ADR 0053).
- **TODO(ejer): slette-SLA.** Hvor hurtigt skal en anmodning effektueres? Flowet er manuelt udløst af admin; der er
  ingen frist, påmindelse eller kø.
- **TODO(ejer): lead-partner-regler.** Fjernes en lead-partner, flytter `planBoardChange` leadet til den første
  interne — en pladsholder, ikke en beslutning.
- **TODO(mads):** verificér PostHog-scope og Resend-kontaktsletning live; find slette-API'er til Cal.com
  (attendee/sæde), inMobile og Ordbogen; fase 6 afprøver flowet ende-til-ende mod rigtige systemer.
