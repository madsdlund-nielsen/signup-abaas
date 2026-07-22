# 0019 — Partner-katalog: datamodel + scope

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** delvist — honorarsats (🔴 pris) og lead-partner-regler udelades/flag'es; besluttes ikke her

## Kontekst

Fase 1.4 skal levere partner-kataloget: admin opretter partnere, redigerer profiler og **tildeler
kompetence-tags autoritativt** (partner må ikke redigere egne tags). Kataloget er den side af
matchningen som 1.5 filtrerer imod. To ting skal afklares: (1) hvordan partnere *oprettes* og
modelleres, og (2) hvilke af byggespec §5.3's profilfelter der er sikre at bygge nu.

Der findes **ingen** partner-oprettelse i dag: `provisioning.ts` provisionerer kun `ejer`, der er
ingen partner-login/-signup, og spec'en siger kataloget er "admin har fuld kontrol", eksterne
"provisioneres/afvikles programmatisk". Flere §5.3-felter rører uafklarede/senere punkter
(honorarsats = 🔴 pris; rating/antal-møder = fase 4; tilgængelighedsvindue = fase 5).

## Overvejede muligheder

- **A — admin-forfattet katalog, afkoblet fra auth:** `partner_profile` med egen uuid-PK; admin
  opretter/redigerer via service-role; tags admin-only. Partner-login + self-edit udskydes.
- **B — partner som fuld auth-bruger nu:** admin opretter auth.users (invite-mails), partner-ruter
  og self-service-redigering med det samme. Fuldt §5.3, men stort, og partner-onboarding er uafklaret.
- **Felter:** byg alle §5.3 vs. kun de "sikre".

## Beslutning

**A + kun sikre felter.** `partner_profile` (egen uuid, afkoblet fra `auth.uid()`) med navn, titel,
`is_internal` (intern/ekstern), sprog, personlig info, kort/lang bio, billede, sort_order; +
`partner_profile_competence_tag` M2M. RLS: **admin-only select**, ingen write-policies (writes via
service-role), **ingen partner-policies** → "tags read-only for partner" håndhæves ved fravær.
`setPartnerTags` = replace-whole-set (spejler `setOptionTags`).

**Udskudt/flag:** partner-login + self-service-profil (`// TODO(mads)`, spores i Fase 2);
`honorarsats` (`// TODO(ejer)`, 🔴 pris); rating/antal-møder (fase 4); tilgængelighedsvindue (fase 5).
`board_partner.partner_id → app_user` er urørt; afstemning katalog↔board-medlemskab hører til 1.5/1.6.

Dette oplåser 1.5-matching (som kun behøver katalog + tags) med mindst mulig overflade og uden at
beslutte pris/jura/partner-onboarding.

## Konsekvenser

- **Positive:** admin får fuld katalogkontrol nu; 1.5 har et join-bart partner↔tag-signal; genbruger
  `competence_tag` + admin-CRUD-mønsteret uændret; ingen personfølsom bred eksponering (kun admin).
- **Negative / pris:** kataloget er (endnu) afkoblet fra partner-auth — når partner-login besluttes,
  skal katalogpost ↔ auth-bruger kobles (og en ejer/authed read-policy tilføjes til board-visning i
  1.5/1.6). To udskudte felt-grupper skal tilføjes i senere faser.
- **Opfølgning:** Fase 2 sporer partner-login + self-service-profil; 1.5/1.6 tilføjer read-policy +
  katalog↔board-afstemning; lead-partner-udpegning forbliver `// TODO(ejer): lead-partner regler`.
