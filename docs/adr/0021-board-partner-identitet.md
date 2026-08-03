# 0021 — Board-medlemskab peger på partner-kataloget, ikke på auth-brugere

- **Status:** Accepteret
- **Dato:** 2026-08-03
- **Fase:** 1
- **Berører uafklaret punkt:** nej (teknisk datamodelvalg; lead-partner-regler og board-livscyklus forbliver flaget)

## Kontekst

Fase 1.5 skal skrive matchingens resultat: 2-3 partnere på ejerens board. Men de to sider af
matchningen lever i hver sit identitetsrum:

- `board_partner.partner_id` (0002) refererer `app_user(id)` — altså `auth.uid()`.
- `partner_profile.id` (0009) er en selvstændig uuid. ADR 0019 valgte bevidst at afkoble kataloget
  fra auth, så admin kan oprette katalogposter uden at provisionere login-konti; partner-login blev
  udskudt til Fase 2.

Der findes **ingen** koblingskolonne mellem dem, og der er ingen `app_user`-rækker der svarer til
katalogposterne. Konsekvensen er konkret: matchingen producerer `partner_profile`-id'er, som
`board_partner` ikke kan modtage. Uden en beslutning her kan 1.5 ikke gemme noget. ADR 0019
forudser præcis dette: *"`board_partner.partner_id → app_user` er urørt; afstemning katalog↔board-
medlemskab hører til 1.5/1.6."*

Undervejs blev det desuden opdaget at **`board_partner` aldrig fik slået RLS til** — 0002 aktiverede
kun `board`. Da rollen `authenticated` har fulde table grants, kunne enhver logget-ind bruger skrive
sig selv ind på et vilkårligt board og derved låse `board_select_partner` op på en fremmed ejers
board. Hullet var latent fordi ingen fase hidtil har skrevet til tabellen; 1.5 er den første.

## Overvejede muligheder

- **A — skift FK til `partner_profile(id)`.** Kataloget er puljen, så boardet består af katalogposter.
- **B — behold FK mod `app_user` og tilføj `partner_profile.app_user_id uuid null` som blød kobling.**
  Løser ikke problemet i dag: kolonnen ville være null for samtlige katalogposter, så der er stadig
  intet at skrive. Ville kræve at partner-login (Fase 2) blev trukket frem.
- **C — provisionér auth-brugere for hver katalogpost nu.** Genåbner den partner-onboarding ADR 0019
  netop udskød, og skaber login-konti ingen bruger.

## Beslutning

**A.** `board_partner.partner_id` refererer nu `partner_profile(id) on delete cascade`.

Følgevirkninger, alle i migration `0010_board_matching.sql`:

- **`board_select_partner` fjernes.** Policyen byggede på `bp.partner_id = auth.uid()`, hvilket ikke
  længere giver mening. Dertil ville den efter RLS-aktiveringen læse `board_partner`, hvis egen
  policy læser `board` → `infinite recursion detected in policy`. Partner-synlighed genindføres i
  Fase 2 sammen med partner-login. `TODO(mads): partner-login`.
- **RLS aktiveres på `board_partner`** med `board_partner_select_owner` (via boardets `owner_id`) og
  `board_partner_select_admin`. Ingen write-policies — writes går via service-role bag
  `requireRole('ejer')`, spejlet fra katalog-writes i 0009.
- **Ejeren får `partner_profile_select_board_owner`** (+ tilsvarende på M2M'en), scopet til de
  profiler der sidder på hendes eget board. Puljen under matching/udskift eksponeres bevidst ikke
  via RLS; den læses server-side med service-role. 0009 forudser policyen og advarer om
  GDPR-overfladen — derfor den snævre scoping frem for "authed må se kataloget".
- **Eksisterende `board_partner`-rækker slettes** i migrationen. `app_user`- og `partner_profile`-id'er
  er disjunkte rum uden mapping, så de kan ikke konverteres. I praksis er tabellen tom: der har
  aldrig eksisteret et board-oprettelsesflow i appen.

Invarianten "mindst 1 intern partner pr. board" (byggespec §3/§5.6) håndhæves i applikationslaget
(`src/server/boards/actions.ts`), ikke som DB-constraint — den er en betingelse på tværs af rækker.

## Konsekvenser

- **Positive:** matchingen kan skrive sit resultat; kataloget er én autoritativ partner-identitet;
  et reelt sikkerhedshul lukkes; ejerens katalog-eksponering er minimal (kun eget board).
- **Negative / pris:** partnere kan indtil videre ikke se deres eget board — `board_select_partner`
  er væk indtil Fase 2. Det er acceptabelt nu, da der ikke findes partner-login eller partner-UI.
  Service-role i matchingens læsevej betyder at RLS ikke er sikkerhedsnettet dér; `requireRole('ejer')`
  og eksplicit ejerskabstjek i actions bærer ansvaret i stedet.
- **Opfølgning (Fase 2):** tilføj `partner_profile.app_user_id`, kobl katalogpost ↔ auth-bruger, og
  genindfør partner-synlighed på boardet via den kobling.
