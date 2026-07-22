-- Fix — deploy RLS-policies via migrations-strømmen.
--
-- Policies lå tidligere i supabase/policies/*.sql. Supabase' migrations-deploy (og GitHub-
-- integrationen) anvender KUN supabase/migrations/ — aldrig den mappe. Resultat i prod: RLS var
-- slået til (via 0002/0003/0005) men UDEN policies → al session-baseret (authed) læsning gav 0
-- rækker. Auth overlevede kun fordi roller læses med service-role (bypasser RLS).
--
-- Denne migration flytter alle eksisterende policies ind i migrations-strømmen, så de deployes
-- automatisk. Fremover skrives policies i SAMME migration som tabellen (ADR 0007, opdateret).
-- Idempotent (drop if exists → create), så den er sikker uanset delvist forudgående tilstand.

-- --- app_user / user_role_assignment (tabeller 0001, RLS 0003) ---
drop policy if exists app_user_select_self on app_user;
create policy app_user_select_self on app_user
  for select using (id = auth.uid());

drop policy if exists user_role_assignment_select_self on user_role_assignment;
create policy user_role_assignment_select_self on user_role_assignment
  for select using (user_id = auth.uid());

-- --- board (0002) ---
drop policy if exists board_select_owner on board;
create policy board_select_owner on board
  for select using (owner_id = auth.uid());

drop policy if exists board_select_partner on board;
create policy board_select_partner on board
  for select using (
    exists (
      select 1 from board_partner bp
      where bp.board_id = board.id and bp.partner_id = auth.uid()
    )
  );

drop policy if exists board_select_admin on board;
create policy board_select_admin on board
  for select using (
    exists (
      select 1 from user_role_assignment ura
      where ura.user_id = auth.uid() and ura.role = 'admin'
    )
  );

-- --- competence_tag (0005) ---
drop policy if exists competence_tag_select_authenticated on competence_tag;
create policy competence_tag_select_authenticated on competence_tag
  for select using (auth.uid() is not null);
