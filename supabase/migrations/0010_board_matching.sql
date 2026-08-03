-- Fase 1.5 — board-matching. Byggespec §5.2, ADR 0021 (identitets-afstemning) + ADR 0022 (matching).
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent).
--
-- Tre ting sker her:
--   1. board_partner.partner_id peger nu på partner_profile(id) i stedet for app_user(id). Kataloget
--      (1.4) ER puljen matchingen vælger fra, og katalogposter har bevidst ingen auth-konti (ADR 0019).
--      Uden dette skift kan matchingen ikke skrive sit resultat nogen steder.
--   2. board_partner fik ALDRIG slået RLS til (0002 slog kun `board` til). Da rollen `authenticated`
--      har fulde table grants, kunne enhver logget-ind bruger indtil nu skrive sig selv ind på et
--      vilkårligt board — og derved låse board_select_partner op på en fremmed ejers board. 1.5 er
--      første fase der faktisk skriver til tabellen, så hullet lukkes her.
--   3. Ejeren får en snævert scopet read-policy på kataloget: kun profiler der sidder på HENDES board.
--      Puljen under matching/udskift eksponeres ikke via RLS (GDPR — jf. 0009's egen advarsel); den
--      beregnes server-side via service-role bag requireRole('ejer').

-- --- 1. Identitets-afstemning: board_partner.partner_id → partner_profile ---

-- app_user- og partner_profile-id'er er disjunkte id-rum, og der findes ingen kobling mellem dem
-- (ADR 0019 udskød partner-login til Fase 2). Eksisterende rækker kan derfor ikke mappes over — de
-- fjernes. I praksis er tabellen tom: der har aldrig eksisteret et board-oprettelsesflow i appen.
delete from board_partner where partner_id not in (select id from partner_profile);

alter table board_partner drop constraint if exists board_partner_partner_id_fkey;
alter table board_partner add constraint board_partner_partner_id_fkey
  foreign key (partner_id) references partner_profile(id) on delete cascade;

-- board_select_partner byggede på `bp.partner_id = auth.uid()`, hvilket ikke længere giver mening:
-- partner_id er nu en katalogpost, ikke en auth-bruger. Dertil ville policyen efter punkt 2 læse
-- board_partner, hvis egen policy læser board → "infinite recursion detected in policy". Den fjernes.
-- TODO(mads): partner-login — genindfør partner-synlighed via partner_profile.app_user_id i Fase 2.
drop policy if exists board_select_partner on board;

-- --- 2. RLS på board_partner (manglede helt siden 0002) ---

alter table board_partner enable row level security;

-- Ejeren ser medlemskaberne på sit eget board; admin ser alt. Ingen partner-policy: partner_id peger
-- nu på en katalogpost uden auth-konto, så en partner kan ikke identificere sig selv her endnu.
drop policy if exists board_partner_select_owner on board_partner;
create policy board_partner_select_owner on board_partner
  for select using (
    exists (
      select 1 from board b
      where b.id = board_partner.board_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists board_partner_select_admin on board_partner;
create policy board_partner_select_admin on board_partner
  for select using (has_role('admin'));

-- Ingen write-policies: board-writes går via service-role bag requireRole('ejer'), præcis som
-- katalog-writes går via service-role bag requireRole('admin') i 0009.
-- Reglen "mindst 1 intern partner pr. board" (byggespec §3/§5.6) håndhæves i matching-laget, ikke
-- som DB-constraint: den er en betingelse på tværs af rækker og hører til ved board-oprettelse.

-- --- 3. Ejer-read-policy på kataloget, scopet til eget board ---

-- Bevidst snæver: ejeren ser KUN de profiler der faktisk sidder på hendes board — ikke hele puljen.
-- 0009 forudser præcis denne policy og advarer mod bredere eksponering (GDPR).
drop policy if exists partner_profile_select_board_owner on partner_profile;
create policy partner_profile_select_board_owner on partner_profile
  for select using (
    exists (
      select 1
      from board_partner bp
      join board b on b.id = bp.board_id
      where bp.partner_id = partner_profile.id and b.owner_id = auth.uid()
    )
  );

drop policy if exists partner_profile_competence_tag_select_board_owner
  on partner_profile_competence_tag;
create policy partner_profile_competence_tag_select_board_owner on partner_profile_competence_tag
  for select using (
    exists (
      select 1
      from board_partner bp
      join board b on b.id = bp.board_id
      where bp.partner_id = partner_profile_competence_tag.partner_profile_id
        and b.owner_id = auth.uid()
    )
  );
