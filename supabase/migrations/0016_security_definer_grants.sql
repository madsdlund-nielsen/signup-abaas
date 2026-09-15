-- Sikkerhedshygiejne — fjern den unødvendige EXECUTE-rettighed på trigger-funktionen fra 0004.
-- Udløst af Supabase' database-linter (0028/0029: SECURITY DEFINER-funktion eksekverbar for
-- anon/authenticated). Baggrund og de bevidst URØRTE funktioner: ADR 0047.
--
-- Supabase sætter `alter default privileges ... grant all on functions to anon, authenticated`,
-- så enhver ny public-funktion eksponeres som /rest/v1/rpc/<navn>. For en trigger-funktion er
-- den rettighed ren støj: Postgres afviser direkte kald ("trigger functions can only be called
-- as triggers"), og triggeren fyrer uafhængigt af kalderens EXECUTE (verificeret mod PG 16).
-- Vi fjerner den alligevel — et eksponeret endpoint der ikke skal bruges, skal ikke være der.
--
-- has_role (0005) og is_partner_on_board (0011) røres IKKE. De KALDES af RLS-policies og
-- evalueres med kalderens rettigheder; uden EXECUTE fejler enhver authed læsning med
-- "permission denied for function" i stedet for at filtrere. Se ADR 0047.

do $$
declare
  fn text := 'public.handle_auth_user_deleted()';
begin
  -- 0004 opretter kun funktionen hvis auth.users findes (Supabase i prod, shim i test).
  if to_regprocedure(fn) is null then
    return;
  end if;

  -- Default-grant'et til PUBLIC (Postgres' egen) og Supabase' eksplicitte rolle-grants.
  execute format('revoke all on function %s from public', fn);

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %s from anon', fn);
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %s from authenticated', fn);
  end if;
end $$;
