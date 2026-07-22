-- Fase 1.1 (hardening) — ryd app-data op når en Supabase-auth-bruger slettes.
--
-- app_user har bevidst INGEN hård FK til auth.users (jf. 0001, så schemaet kan køre uændret
-- lokalt uden auth-skema). Konsekvensen er at sletning af en auth-bruger efterlader app_user +
-- user_role_assignment (og board via FK) som forældreløse rækker. Denne trigger lukker hullet:
-- ved sletning af auth.users fjernes den matchende app_user, og resten cascader via de
-- eksisterende FKs (user_role_assignment, board → on delete cascade).
--
-- Betinget: kun hvis auth.users findes (Supabase i prod; test-shimmen lokalt). På ren Postgres
-- uden shim springes den over uden fejl.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    create or replace function public.handle_auth_user_deleted()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
    as $fn$
    begin
      delete from public.app_user where id = old.id;
      return old;
    end;
    $fn$;

    drop trigger if exists on_auth_user_deleted on auth.users;
    create trigger on_auth_user_deleted
      after delete on auth.users
      for each row execute function public.handle_auth_user_deleted();
  end if;
end $$;
