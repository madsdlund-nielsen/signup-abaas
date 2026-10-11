-- B-66 — boardets sammensætning som ÉN transaktion (ADR 0064). Naming: ADR 0006 (snake_case).
--
-- Hvorfor en funktion: supabase-js har ingen transaktioner, så `applyPlan` skrev i trin (indsæt →
-- slet → flyt lead). Fejlede et senere trin stod boardet i en mellemtilstand, og to samtidige
-- ændringer (ejer + admin) kunne læse samme udgangspunkt. En plpgsql-funktion ER én transaktion:
-- alle trin og revisionssporet (`board_change`, 0025) lykkes eller rulles tilbage samlet.
--
-- Funktionen tager PLANEN, ikke en ændring: lead-reglen ("bevar lead, ellers den indkommende,
-- ellers første interne") er et uafklaret ejer-punkt (TODO(ejer): lead-partner regler) og bor ét
-- sted, i src/server/boards/composition.ts. Funktionen er sidste værn, ikke en kopi af
-- planlægningen: den
--   1. tager rækkelås på boardet (to samtidige ændringer serialiseres),
--   2. afviser planen hvis medlemmerne ikke længere er dem koden læste (`p_expected_partner_ids`,
--      optimistisk samtidighedstjek → 40001), så en forældet plan aldrig overskriver en andens ændring,
--   3. skriver planen,
--   4. HÅNDHÆVER invarianterne på det færdige board: 2-3 partnere, mindst én intern, præcis én lead
--      og den er intern. Bryder resultatet en af dem, rulles alt tilbage.
-- Invarianterne afvises stadig i TypeScript FØR kaldet (danske fejl uden at røre basen); det her
-- er værnet hvis koden og basen en dag er uenige, eller en anden skrivevej opstår.
--
-- Revisionsrækken skrives med calcom_sync = 'fejlet' for handlinger der ændrer værterne
-- (tilfoej/fjern/udskift) og 'sprunget_over' for saet_lead. Cal.com-synkroniseringen sker UDEN FOR
-- transaktionen (en ekstern leverandørs oppetid er ikke en betingelse for at rette et board), og
-- koden overskriver værdien bagefter med det faktiske udfald. Dør processen midt imellem, står
-- sporet pessimistisk ("hosts hænger efter") frem for at skjule en manglende synkronisering.
--
-- SECURITY INVOKER: kaldes kun med service-role (revoke nedenfor), som i forvejen omgår RLS.
-- Funktionen giver ingen ekstra rettigheder (ADR 0047).

create function change_board_composition(
  p_board_id uuid,
  p_expected_partner_ids uuid[],
  p_add uuid[],
  p_remove uuid[],
  p_lead_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_partner_id uuid,
  p_replaced_partner_id uuid
) returns uuid
language plpgsql as $$
declare
  v_add uuid[] := coalesce(p_add, '{}');
  v_remove uuid[] := coalesce(p_remove, '{}');
  v_current uuid[];
  v_expected uuid[];
  v_members int;
  v_leads int;
  v_internal_leads int;
  v_change_id uuid;
begin
  if p_action is null or p_action not in ('tilfoej', 'fjern', 'udskift', 'saet_lead') then
    raise exception 'Ukendt sammensætningshandling.';
  end if;

  -- 1. Rækkelås: den der kommer sidst venter, og genvurderer mod den førstes resultat.
  perform 1 from board where id = p_board_id for update;
  if not found then
    raise exception 'Board ikke fundet.';
  end if;

  -- 2. Planen skal bygge på det board der faktisk ligger der nu.
  select coalesce(array_agg(partner_id order by partner_id), '{}') into v_current
    from board_partner where board_id = p_board_id;
  select coalesce(array_agg(x order by x), '{}') into v_expected
    from unnest(coalesce(p_expected_partner_ids, '{}')) as x;
  if v_current <> v_expected then
    raise exception 'Boardet blev ændret af en anden imens — genindlæs og prøv igen.'
      using errcode = '40001';
  end if;
  if v_add && v_current then
    raise exception 'Partneren sidder allerede på boardet.';
  end if;
  if not (v_remove <@ v_current) then
    raise exception 'Partneren sidder ikke på boardet.';
  end if;

  -- 3. Skrivningen. Rækkefølgen er irrelevant her: alt eller intet.
  insert into board_partner (board_id, partner_id, is_lead)
    select p_board_id, x, false from unnest(v_add) as x;
  delete from board_partner where board_id = p_board_id and partner_id = any(v_remove);
  update board_partner
     set is_lead = coalesce(partner_id = p_lead_id, false)
   where board_id = p_board_id
     and is_lead is distinct from coalesce(partner_id = p_lead_id, false);

  -- 4. Invarianterne på det færdige board (spejler assertBoardShape + lead-reglen i koden).
  select count(*), count(*) filter (where bp.is_lead),
         count(*) filter (where bp.is_lead and pp.is_internal)
    into v_members, v_leads, v_internal_leads
    from board_partner bp join partner_profile pp on pp.id = bp.partner_id
   where bp.board_id = p_board_id;
  if v_members < 2 or v_members > 3 then
    raise exception 'Et board skal bestå af 2-3 partnere.';
  end if;
  if not exists (
    select 1 from board_partner bp join partner_profile pp on pp.id = bp.partner_id
     where bp.board_id = p_board_id and pp.is_internal
  ) then
    raise exception 'Et board skal have mindst én intern partner.';
  end if;
  if v_leads <> 1 then
    raise exception 'Et board skal have præcis én lead.';
  end if;
  if v_internal_leads <> 1 then
    raise exception 'Kun en intern partner kan være lead.';
  end if;

  insert into board_change (
    board_id, actor_id, actor_role, action, partner_id, replaced_partner_id, calcom_sync
  ) values (
    p_board_id, p_actor_id, p_actor_role, p_action, p_partner_id, p_replaced_partner_id,
    case when p_action = 'saet_lead' then 'sprunget_over' else 'fejlet' end
  )
  returning id into v_change_id;

  return v_change_id;
end $$;

-- Supabase eksponerer nye public-funktioner som /rest/v1/rpc/<navn> for anon/authenticated
-- (default privileges, ADR 0047). En ejer må ikke kunne kalde den direkte og dermed springe
-- ejerskabstjekket i src/server/boards/actions.ts over — kun service-role, bag rolle-/ejerskabs-
-- tjekket. Samme guardede revoke som 0016/0021/0023.
do $$
declare
  fn text := 'public.change_board_composition(uuid, uuid[], uuid[], uuid[], uuid, uuid, text, text, uuid, uuid)';
begin
  execute format('revoke all on function %s from public', fn);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %s from anon', fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %s from authenticated', fn);
  end if;
end $$;
