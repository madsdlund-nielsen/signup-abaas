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
3. **Eksterne behandlere** (kun de aktive flag; via adapter):

| Leverandør | Hvad slettes/anonymiseres | Note |
|---|---|---|
| Cal.com | **Ejer/kunde:** aflys/anonymisér møder — de er *attendees* og har ingen konto. **Partner:** fjern som host på boardets collective event type og som teammedlem (frigør sædet) | Teams-plan (ADR 0046). Ingen managed users at slette |
| Cal Video | Slet optagelser knyttet til brugerens møder | 🔴 optagelse er ikke bygget; kræver samtykkeflow (ejer) |
| Alunta | Slet/anonymisér kunde + medlemskab | 🔴 fakturadata kan være underlagt opbevaringspligt (jura) |
| QuickPay (gateway + indløser) | Slet/anonymisér korttoken + betalingsmetadata | 🔴 transaktionsdata er typisk underlagt opbevaringspligt (jura) |
| e-conomic / Dinero | **Slet IKKE** bogførte bilag (lovpligtig opbevaring, typ. 5 år) — afkobl PII hvor muligt | 🔴 TODO(ejer/jura) |
| Ordbogen (Odin-LLM) | Ingen persistering hos LLM hvis stateless; slet resuméer i Supabase | verificér stateless-antagelsen ved opsætning |
| Ordbogen (transskription) | Slet transskript + kildelyd | samme konto som LLM |
| Resend | Tilføj til suppression / slet kontakt | |
| inMobile | Slet telefonnummer | |
| PostHog | GDPR person-delete via `distinctId` | EU |

4. **Kvittér** sletningen (tidsstempel + hvilke systemer) og log uden PII.

> **Bemærk (ADR 0046):** kun **rådgivere og admin** har en Cal.com-brugerkonto. Ejere og
> kunder booker som attendees med `{ navn, e-mail, tidszone }` og har intet at slette ud over
> selve bookingerne. En partnersletning frigør desuden et betalt sæde.

## Afhængigheder (🔴 flag — beslut ikke)

- **Opbevaringspligt vs. sletning:** bogføring (e-conomic/Dinero) og betalingsdata
  (Alunta/QuickPay) kan være underlagt lovkrav der overstyrer sletning. TODO(ejer/jura): definér opbevarings-
  perioder og hvad der kan anonymiseres frem for slettes.
- **Slette-vindue/SLA:** hvor hurtigt skal en anmodning effektueres? TODO(ejer).
- Den rigtige `eraseDataSubject`-portmetode + UI bygges når de tilhørende adaptere udfyldes
  (efter account-adgang).
