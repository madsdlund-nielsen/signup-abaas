-- Fase 2.8 — partner-login: katalogpost ↔ auth-bruger. Byggespec §5.3/§6, ADR 0025.
-- Lukker opfølgningen fra ADR 0019 (partner-login udskudt) og ADR 0021 (board_select_partner
-- fjernet fordi partner_id blev en katalogpost uden auth-konto). Naming: ADR 0006. RLS: ADR 0007.

-- Koblingen: en katalogpost KAN have en auth-bruger bag sig. Null = ikke inviteret endnu.
-- unique → én katalogpost pr. auth-bruger; on delete set null → sletning af auth-brugeren
-- efterlader katalogposten (admin-forfattet data består, jf. ADR 0019).
alter table partner_profile
  add column app_user_id uuid unique references app_user(id) on delete set null;

-- Hjælpefunktion til partner-synlighed. SECURITY DEFINER (som has_role, 0005) af to grunde:
-- (1) policies på board_partner kan ikke selv læse board_partner uden uendelig rekursion,
-- (2) byggespec §6 foreskriver eksplicit "Adgang for partnere via SECURITY DEFINER-
-- hjælpefunktioner". auth.uid() er schema-kvalificeret via search_path = public.
create or replace function public.is_partner_on_board(check_board_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1
    from public.board_partner bp
    join public.partner_profile pp on pp.id = bp.partner_id
    where bp.board_id = check_board_id and pp.app_user_id = auth.uid()
  );
$$;

-- --- Genopliv partner-synlighed på board (fjernet i 0010, varslet i ADR 0021) ---
drop policy if exists board_select_partner on board;
create policy board_select_partner on board
  for select using (is_partner_on_board(board.id));

drop policy if exists board_partner_select_partner on board_partner;
create policy board_partner_select_partner on board_partner
  for select using (is_partner_on_board(board_partner.board_id));

-- --- Partner-read-policies på kataloget ---
-- Egen profil (self-service-redigering læser herfra; writes går via service-role bag
-- eksplicit ejerskabstjek — ingen write-policies, tags forbliver admin-styrede ved fravær).
drop policy if exists partner_profile_select_self on partner_profile;
create policy partner_profile_select_self on partner_profile
  for select using (app_user_id = auth.uid());

-- Profiler på partnerens egne boards (portalen viser boardets øvrige medlemmer).
drop policy if exists partner_profile_select_board_member on partner_profile;
create policy partner_profile_select_board_member on partner_profile
  for select using (
    exists (
      select 1 from board_partner bp
      where bp.partner_id = partner_profile.id and is_partner_on_board(bp.board_id)
    )
  );

-- Tags for de profiler partneren kan se (egen + eget boards medlemmer). Read-only —
-- "partner kan IKKE redigere egne tags" håndhæves fortsat ved fravær af write-policies.
drop policy if exists partner_profile_competence_tag_select_partner
  on partner_profile_competence_tag;
create policy partner_profile_competence_tag_select_partner on partner_profile_competence_tag
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = partner_profile_competence_tag.partner_profile_id
        and (
          pp.app_user_id = auth.uid()
          or exists (
            select 1 from board_partner bp
            where bp.partner_id = pp.id and is_partner_on_board(bp.board_id)
          )
        )
    )
  );
