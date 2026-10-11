-- Skive Q — GDPR-sletning (art. 17): kvitteringstabel + sletning som ÉN transaktion (ADR 0068).
-- Naming: ADR 0006 (ental, snake_case). RLS: ADR 0007 (policies i migrationen, <tabel>_<operation>_<rolle>,
-- idempotent).
--
-- Del 1 — `erasure_receipt`: kvitteringen for en sletning. INGEN persondata: kun et pseudonymt
-- id-hash (SHA-256 af bruger-id'et — id'et selv er væk fra basen når sletningen er gennemført),
-- tidspunktet, den admin der udførte den, hvilke systemer der blev rørt og med hvilket udfald.
-- `systems` er en liste af { system, status, detail } hvor `detail` er en fast, dansk tekst uden
-- navne, adresser eller leverandørsvar (koden skrubber fejltekster før de kommer hertil).
--
-- Del 2 — `erase_data_subject`: Supabase-delen af sletningen i én transaktion. Skriv-fladen er
-- service-role bag et admin-tjek (src/server/erasure); funktionen er sidste værn for to ting koden
-- ikke må kunne springe over, selv ved et løb mellem planlægning og udførelse:
--   1. OPBEVARINGSPLIGT (🔴 ejer/jura — TODO(ejer/jura): opbevaringsperioder). Hvad der er
--      bogføringsbærende er ikke afgjort, så funktionen er FAIL-CLOSED: en person med
--      medlemskab/betalingstræk på et board vedkommende ejer, eller med et registreret honorar-
--      grundlag (`meeting_partner.registered_status`), kan ikke slettes — uanset hvad koden mener.
--   2. BOARDETS INVARIANTER (B-68, ADR 0064). `board_partner.partner_id` er `on delete cascade`
--      (0010): en sletning af katalogposten ville stille og roligt tage partneren af alle sine
--      boards uden at 2-3 partnere / mindst én intern / præcis én lead holdes. Funktionen fjerner
--      derfor partneren fra hvert board via `change_board_composition` (0026) FØR katalogposten
--      slettes — den håndhæver invarianterne på det færdige board og skriver revisionsrækken i
--      samme transaktion. Kan et board ikke fjernes fra uden at bryde dem, ruller hele sletningen
--      tilbage, og admin må udskifte partneren først.
--
-- Lead-reglen ("bevar lead, ellers den første interne") er et uafklaret ejer-punkt (TODO(ejer):
-- lead-partner regler) og bor kun i TypeScript (`planBoardChange`); funktionen får PLANEN
-- (`p_board_removals`), ligesom `change_board_composition`.
--
-- `app_user`-rækken beholdes bevidst (blankeret: navn og telefon fjernet) som anker til
-- Supabase Auth-sletningen (`auth.admin.deleteUser`, hvis trigger fra 0004 fjerner rækken) og som
-- opslagsnøgle hvis en ekstern behandler fejlede og sletningen skal genkøres (idempotent).
--
-- SECURITY INVOKER og revoked fra klientrollerne (ADR 0047): kun service-role kalder den.

create table erasure_receipt (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 (hex) af bruger-id'et. Pseudonymt: gør det muligt at se at en genkørsel hører til samme
  -- person uden at kvitteringen kan slå nogen op.
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  -- Hvem udførte sletningen. Admin er en person: nulstilles hvis adminens egen konto slettes.
  requested_by uuid references app_user(id) on delete set null,
  executed_at timestamptz not null default now(),
  -- gennemfoert: Supabase + Supabase Auth er slettet (kontoankeret er væk).
  -- delvist:     Supabase-dataene er slettet, men et system fejlede og kontoankeret (blankeret) står
  --              tilbage, så sletningen kan genkøres.
  outcome text not null check (outcome in ('gennemfoert', 'delvist')),
  -- [{ "system": "supabase", "status": "slettet", "detail": "…" }, …]
  systems jsonb not null check (jsonb_typeof(systems) = 'array'),
  -- Systemer der ikke er slettet automatisk (fejlet / ikke konfigureret / manuel), til admins overblik.
  missing text[] not null default '{}'
);

create index erasure_receipt_executed_idx on erasure_receipt (executed_at desc);
create index erasure_receipt_subject_idx on erasure_receipt (subject_hash);

alter table erasure_receipt enable row level security;

-- Kun admin læser. INGEN write-policies: rækker skrives af service-role bag requireRole('admin')
-- i src/server/erasure.
drop policy if exists erasure_receipt_select_admin on erasure_receipt;
create policy erasure_receipt_select_admin on erasure_receipt
  for select using (has_role('admin'));

create function erase_data_subject(
  p_user_id uuid,
  p_actor_id uuid,
  -- [{ "board_id", "expected_partner_ids": [...], "partner_id", "lead_id" | null }] — planen for
  -- hvert board partneren sidder på (beregnet i TypeScript, valideret her af change_board_composition).
  p_board_removals jsonb
) returns jsonb
language plpgsql as $$
declare
  v_profile_id uuid;
  v_removal jsonb;
  v_change_id uuid;
  v_changes jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if p_user_id is null or p_actor_id is null then
    raise exception 'Både person og udførende admin er påkrævet.';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'En admin kan ikke slette sig selv.';
  end if;

  -- 1. Lås personen (to samtidige sletninger serialiseres) og find evt. katalogprofil.
  perform 1 from app_user where id = p_user_id for update;
  if not found then
    raise exception 'Personen findes ikke.' using errcode = 'P0002';
  end if;
  select id into v_profile_id from partner_profile where app_user_id = p_user_id;

  -- 2. Fail-closed på opbevaringspligt. Samme tjek som planen, gentaget her fordi et medlemskab
  -- kan opstå mellem planlægning og udførelse.
  if exists (
    select 1 from membership m join board b on b.id = m.board_id where b.owner_id = p_user_id
  ) or exists (
    select 1 from payment_charge pc
      join membership m on m.id = pc.membership_id
      join board b on b.id = m.board_id
     where b.owner_id = p_user_id
  ) then
    raise exception 'opbevaringspligt: personen har betalingsdata (medlemskab/betalingstræk) på et board vedkommende ejer — afventer afklaring af opbevaringspligt.';
  end if;
  if exists (
    select 1 from meeting_partner mp
      join meeting mt on mt.id = mp.meeting_id
      join board b on b.id = mt.board_id
     where mp.registered_status is not null and b.owner_id = p_user_id
  ) or (
    v_profile_id is not null and exists (
      select 1 from meeting_partner mp
       where mp.partner_profile_id = v_profile_id and mp.registered_status is not null
    )
  ) then
    raise exception 'opbevaringspligt: personen indgår i et registreret honorargrundlag — afventer afklaring af opbevaringspligt.';
  end if;

  -- Sidste admin kan ikke slettes (ellers er der ingen der kan administrere platformen).
  if exists (select 1 from user_role_assignment where user_id = p_user_id and role = 'admin')
     and not exists (
       select 1 from user_role_assignment where role = 'admin' and user_id <> p_user_id
     ) then
    raise exception 'Den sidste admin kan ikke slettes.';
  end if;

  -- 3. Partneren af hvert board via sammensætningsfunktionen (B-68): invarianter + revisionsspor
  -- i denne transaktion. Planen må kun handle om personens EGEN katalogpost.
  for v_removal in select * from jsonb_array_elements(coalesce(p_board_removals, '[]'::jsonb)) loop
    if v_profile_id is null or (v_removal ->> 'partner_id')::uuid is distinct from v_profile_id then
      raise exception 'Planen peger på en anden partner end personens egen.';
    end if;
    select change_board_composition(
      (v_removal ->> 'board_id')::uuid,
      array(select x::uuid from jsonb_array_elements_text(v_removal -> 'expected_partner_ids') as x),
      '{}'::uuid[],
      array[v_profile_id],
      nullif(v_removal ->> 'lead_id', '')::uuid,
      p_actor_id,
      'admin',
      'fjern',
      v_profile_id,
      null
    ) into v_change_id;
    v_changes := v_changes || jsonb_build_object('board_id', v_removal ->> 'board_id', 'change_id', v_change_id);
  end loop;

  if v_profile_id is not null and exists (select 1 from board_partner where partner_id = v_profile_id) then
    raise exception 'Partneren sidder stadig på et board — udskift partneren på boardet først (B-68).';
  end if;

  -- 4. Selve sletningen. Resten (møder, noter, resuméer, vurderinger, linkene, tilgængelighed …)
  -- følger med via on delete cascade fra board / partner_profile.
  delete from board where owner_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('board', v_n);

  if v_profile_id is not null then
    delete from partner_profile where id = v_profile_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('partner_profile', v_n);
  end if;

  delete from quiz_answer where owner_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('quiz_answer', v_n);

  delete from meeting_rating where rater_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('meeting_rating', v_n);

  delete from rating_link where rater_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('rating_link', v_n);

  delete from notification_delivery where recipient_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('notification_delivery', v_n);

  delete from user_role_assignment where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('user_role_assignment', v_n);

  -- Aktør nulstilles i sporene (rækkerne består som anonym historik).
  update board_change set actor_id = null where actor_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('board_change_actor', v_n);

  update notification_template set published_by = null where published_by = p_user_id;

  -- Kontoankeret blankeres: e-mail beholdes (opslagsnøgle til en genkørsel) til Auth-sletningen
  -- har fjernet rækken.
  update app_user set display_name = null, phone_e164 = null where id = p_user_id;

  return jsonb_build_object('deleted', v_counts, 'board_changes', v_changes);
end $$;

-- Supabase eksponerer nye public-funktioner som /rest/v1/rpc/<navn> for anon/authenticated
-- (default privileges, ADR 0047). Den her sletter personer og må ALDRIG kunne kaldes af en klient —
-- kun service-role, bag admin-tjekket i src/server/erasure. Samme guardede revoke som 0016/0021/0023/0026.
do $$
declare
  fn text := 'public.erase_data_subject(uuid, uuid, jsonb)';
begin
  execute format('revoke all on function %s from public', fn);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %s from anon', fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %s from authenticated', fn);
  end if;
end $$;
