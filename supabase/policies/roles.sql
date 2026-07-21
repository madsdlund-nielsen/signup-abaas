-- RLS-policies for rolle-tabellerne (auth-valg = Supabase Auth, ADR 0013).
-- Mønster: <tabel>_<operation>_<beskrivelse>. auth.uid() leveres af Supabase i prod og
-- af tests/setup/auth-shim.sql lokalt. Se docs/adr/0007-rls-policy-moenster.md.
--
-- KUN select-egne-rækker. Bevidst INGEN insert/update/delete-policies: rolletildeling er
-- en server-side/admin-operation via service-role (som bypasser RLS), aldrig brugerens egen.
-- Negative tests (kan ikke se andres roller, kan ikke selv-tildele) er obligatoriske —
-- se tests/db/roles-rls.test.ts.

-- En bruger ser kun sin egen app_user-række.
create policy app_user_select_self on app_user
  for select
  using (id = auth.uid());

-- En bruger ser kun sine egne rolletildelinger. Dette er også hvad board_select_admin
-- (supabase/policies/board.sql) læner sig op ad: admin kan se sin egen 'admin'-række.
create policy user_role_assignment_select_self on user_role_assignment
  for select
  using (user_id = auth.uid());
