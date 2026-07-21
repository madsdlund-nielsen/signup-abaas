-- Fase 0, Trin 4/5 — RLS-hærdning af rolle-tabellerne (auth-valg = Supabase Auth, ADR 0013).
-- Uden RLS her ville en autentificeret bruger via Supabase' default-grants kunne læse OG
-- skrive user_role_assignment — dvs. selv tildele sig 'admin'. RLS lukker det hul.
-- Mønster jf. docs/adr/0007-rls-policy-moenster.md. Policies ligger i supabase/policies/roles.sql.

-- app_user: en bruger må kun se sin egen række.
alter table app_user enable row level security;

-- user_role_assignment: en bruger må kun se sine egne roller. Ingen skrive-policy →
-- rolletildeling kan kun ske via service-role (server-side), aldrig af brugeren selv.
alter table user_role_assignment enable row level security;
