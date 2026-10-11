# GDPR — sletteflow (data-subject erasure)

> Fase 0 / Trin 10. Skitse af hvordan en brugers persondata slettes på tværs af Supabase
> (sandhedskilde) og hver ekstern sub-processor. Dette er arkitektur-skitsen; den faktiske
> sletteknap + jura-tekster afventer ToS/ejer. Opbevaringspligt (fx bogføring) overstyrer
> sletning og er en 🔴 ejer-/jura-beslutning.

## Princip

Sletning starter i **Supabase** (sandhedskilden) og fanner ud til eksterne behandlere via
**adapter-porten**. Hver adapter får på sigt en `eraseDataSubject(ref)`-kapabilitet (samme
mønster som de øvrige porte i `src/lib`), så domænet kan slette uden at kende leverandøren.
Flowet skal være **idempotent** og efterlade en kvittering/log.

## Rækkefølge

1. **Verificér anmodning** (autentificeret bruger eller admin på vegne af).
2. **Supabase:** slet `app_user`-rækken → FK `on delete cascade` fjerner
   `user_role_assignment`, `board` (ejet) og `board_partner`-medlemskaber. Mødenoter/
   ratings (senere faser) ryddes samme vej.
   Partnerens tilgængelighed (`partner_availability`, `partner_absence`, 0018) hænger på
   `partner_profile` med `on delete cascade` og forsvinder, når katalogposten slettes.
   Fraværsnoten kan indeholde helbredsoplysninger og er derfor privat (ADR 0052).
   Rating-linkene (`rating_link`, 0023, ADR 0060) hænger på mødet, ejeren og partnerens katalogpost
   med `on delete cascade` og forsvinder med dem; rækken holder kun referencer (aldrig tokenet,
   som genskabes af id + `RATING_LINK_SECRET`) og er testet i `tests/db/rating-link-rls.test.ts`.
   Udsendelseslogget (`notification_delivery`, 0021) hænger på `app_user` med `on delete cascade`
   og forsvinder med brugeren; det indeholder alligevel ingen adresser (ADR 0057).
   Kontoprofilen (navn, telefonnummer og tidszone, 0024/ADR 0061; SMS-samtykkekolonnerne er droppet i 0027/ADR 0065) er
   kolonner på selve `app_user`-rækken og forsvinder med den.
3. **Eksterne behandlere** (kun de aktive flag; via adapter):

| Leverandør | Hvad slettes/anonymiseres | Note |
|---|---|---|
| Cal.com | **Ejer/kunde:** aflys/anonymisér møder — de er *attendees* (navn = kontoens navn, ellers e-mail; tidszone, ADR 0061) og har ingen konto. **Partner:** fjern som host på boardets collective event type og som teammedlem (frigør sædet) | Teams-plan (ADR 0046). Ingen managed users at slette |
| Cal Video | Slet optagelser knyttet til brugerens møder | 🔴 optagelse er ikke bygget (L-8). Retsgrundlaget er kontrakten (ADR 0065) — der er intet samtykke at trække tilbage, så sletning sker ved opsigelse/sletteanmodning |
| Alunta | Slet/anonymisér kunde + medlemskab | 🔴 fakturadata kan være underlagt opbevaringspligt (jura) |
| QuickPay (gateway) | Slet/anonymisér korttoken + betalingsmetadata | 🔴 transaktionsdata er typisk underlagt opbevaringspligt (jura) |
| Nets (indløser) | Anmod om sletning/anonymisering af transaktions- og afregningsdata | 🔴 **indløsere er typisk underlagt lovpligtig opbevaring** (hvidvask/bogføring) — sletning kan være helt udelukket. TODO(ejer/jura) |
| e-conomic / Dinero | **Slet IKKE** bogførte bilag (lovpligtig opbevaring, typ. 5 år) — afkobl PII hvor muligt | 🔴 TODO(ejer/jura) |
| Ordbogen (Odin-LLM) | Ingen persistering hos LLM hvis stateless; slet resuméer i Supabase | verificér stateless-antagelsen ved opsætning |
| Ordbogen (transskription) | Slet transskript + kildelyd | samme konto som LLM |
| Resend | Tilføj til suppression / slet kontakt | |
| inMobile | Slet telefonnummer | Nummeret når kun inMobile hvis brugeren har angivet et (ADR 0061, 0065); en bruger uden nummer har intet hos inMobile at slette |
| PostHog | GDPR person-delete via `distinctId` | EU |

4. **Kvittér** sletningen (tidsstempel + hvilke systemer) og log uden PII.

> **Bemærk (ADR 0046):** kun **rådgivere og admin** har en Cal.com-brugerkonto. Ejere og
> kunder booker som attendees med `{ navn, e-mail, tidszone }` og har intet at slette ud over
> selve bookingerne. En partnersletning frigør desuden et betalt sæde.

## Afhængigheder (🔴 flag — beslut ikke)

- **Opbevaringspligt vs. sletning:** bogføring (e-conomic/Dinero) og betalingsdata
  (Alunta/QuickPay/**Nets**) kan være underlagt lovkrav der overstyrer sletning. Indløser-leddet
  er det strammeste af dem. TODO(ejer/jura): definér opbevarings-
  perioder og hvad der kan anonymiseres frem for slettes.
- **Slette-vindue/SLA:** hvor hurtigt skal en anmodning effektueres? TODO(ejer).
- Den rigtige `eraseDataSubject`-portmetode + UI bygges når de tilhørende adaptere udfyldes
  (efter account-adgang).
