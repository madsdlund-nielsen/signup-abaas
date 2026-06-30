-- RLS-policies for board (Trin 5). Mønster: én policy pr. adgangsvej, navngivet
-- <tabel>_<operation>_<rolle>. auth.uid() leveres af Supabase i prod og af en shim
-- i testopsætningen (tests/setup/auth-shim.sql). Se docs/adr/0007-*.md.
--
-- Negative tests er obligatoriske og dækkes i tests/db/rls.test.ts.

-- Ejer ser kun egne boards.
create policy board_select_owner on board
  for select
  using (owner_id = auth.uid());

-- Partner ser boards de er medlem af.
create policy board_select_partner on board
  for select
  using (
    exists (
      select 1
      from board_partner bp
      where bp.board_id = board.id
        and bp.partner_id = auth.uid()
    )
  );

-- Admin ser alle boards.
create policy board_select_admin on board
  for select
  using (
    exists (
      select 1
      from user_role_assignment ura
      where ura.user_id = auth.uid()
        and ura.role = 'admin'
    )
  );
