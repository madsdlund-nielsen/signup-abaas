-- RLS-policies for competence_tag (ADR 0007, <tabel>_<operation>_<rolle>). auth.uid() leveres af
-- Supabase i prod og af tests/setup/auth-shim.sql lokalt.
--
-- KUN select. Bevidst INGEN insert/update/delete-policies: tags redigeres af admin via service-role
-- bag et app-lags requireRole('admin')-check (samme mønster som roles.sql/board.sql). Tags er ikke
-- følsomme — quiz (§1.2), partner-katalog (§1.4) og board-anbefaling læser dem.

-- Enhver logget-ind bruger kan læse tags.
create policy competence_tag_select_authenticated on competence_tag
  for select
  using (auth.uid() is not null);
