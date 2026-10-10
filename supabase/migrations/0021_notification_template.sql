-- Fase 4.5/4.6 — notifikationsskabeloner som versioneret data + udsendelseslog. ADR 0057 (og
-- ADR 0048: kataloget bor i kode, teksten bor her). Naming: ADR 0006 (ental, snake_case).
-- RLS: ADR 0007 (policies i migrationen, <tabel>_<operation>_<rolle>, idempotent).
--
-- INGEN TEKST: tabellen starter TOM og har ingen defaults for emne eller brødtekst (stub-
-- politik: en opfundet skabelon er et plausibelt svar, ikke et synligt hul). Uden en live
-- version for (type, kanal) sender motoren ikke — den logger `fejlet: ingen live skabelon`.
-- TODO(ejer): selve skabelonteksten (forudsætter ToS/samtykke, ADR 0048).

create type notification_channel as enum ('email', 'sms');
create type notification_template_status as enum ('udkast', 'live', 'arkiveret');
create type notification_delivery_status as enum ('afventer', 'sendt', 'fejlet', 'stub', 'demo');

-- En række pr. VERSION af en skabelon for én (beskedtype, kanal). `type_key` er nøglen fra
-- NOTIFICATION_TYPES i src/server/notifications — kataloget (hvem, hvornår, hvilke variabler)
-- hænger sammen med kode, så der er bevidst ingen FK og ingen kopi af kataloget her.
--
-- Livscyklus: udkast → live → arkiveret. Højst ét udkast og højst én live pr. (type, kanal);
-- begge er partielle unikke indekser — constrainten ER mekanismen (som pricing_rule_one_active).
-- Publicering er ikke en redigering: udkastet bliver live og den forrige live bliver arkiveret,
-- så historikken er append-only. Indholdet af en live/arkiveret version kan aldrig ændres
-- (trigger nedenfor) — en sendt besked kan altid føres tilbage til den version der blev brugt.
create table notification_template (
  id uuid primary key default gen_random_uuid(),
  type_key text not null check (type_key ~ '^[a-z][a-z0-9-]*$'),
  channel notification_channel not null,
  version int not null check (version >= 1),
  status notification_template_status not null default 'udkast',
  subject text,                                      -- kun e-mail; null for SMS
  body text not null check (btrim(body) <> ''),
  published_at timestamptz,
  published_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type_key, channel, version),
  constraint notification_template_subject_by_channel check (
    (channel = 'email' and subject is not null and btrim(subject) <> '')
    or (channel = 'sms' and subject is null)
  ),
  -- Et udkast er ikke publiceret; en live/arkiveret version er. (published_by kan blive null
  -- hvis admin-kontoen slettes, derfor kun published_at i kravet.)
  constraint notification_template_published_when_not_draft check (
    (status = 'udkast') = (published_at is null)
  )
);

create unique index notification_template_one_live
  on notification_template (type_key, channel) where status = 'live';
create unique index notification_template_one_draft
  on notification_template (type_key, channel) where status = 'udkast';

-- Historikken er append-only. Indholdsfelterne er låst så snart versionen forlader udkast, og
-- kun de lovlige statusskift findes. Trigger-funktionen er SECURITY INVOKER (ingen definer-
-- rettigheder at eksponere, jf. ADR 0047) og fyrer også for service-role.
create function notification_template_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'udkast' then
      raise exception 'En publiceret skabelonversion kan ikke slettes (append-only historik).';
    end if;
    return old;
  end if;

  if new.id <> old.id or new.type_key <> old.type_key or new.channel <> old.channel
     or new.version <> old.version or new.created_at <> old.created_at then
    raise exception 'Skabelonens identitet (type, kanal, version) kan ikke ændres.';
  end if;

  if old.status = 'udkast' then
    if new.status = 'udkast' then
      return new;                                    -- almindelig redigering af udkastet
    elsif new.status = 'live' then
      if new.subject is distinct from old.subject or new.body <> old.body then
        raise exception 'Indholdet må ikke ændres i samme skridt som publiceringen.';
      end if;
      return new;
    end if;
    raise exception 'Et udkast kan kun blive live.';
  end if;

  -- live / arkiveret: indholdet og publiceringsmærket er låst. published_by må dog nulstilles
  -- af FK'en (on delete set null) når admin-kontoen slettes.
  if new.subject is distinct from old.subject or new.body <> old.body
     or new.published_at is distinct from old.published_at
     or (new.published_by is distinct from old.published_by and new.published_by is not null) then
    raise exception 'En publiceret skabelonversion er uforanderlig.';
  end if;

  if old.status = 'live' and new.status in ('live', 'arkiveret') then return new; end if;
  if old.status = 'arkiveret' and new.status = 'arkiveret' then return new; end if;
  raise exception 'Ugyldigt statusskift: % → %.', old.status, new.status;
end $$;

create trigger notification_template_guard
  before update or delete on notification_template
  for each row execute function notification_template_guard();

-- Atomisk publicering: forrige live → arkiveret og udkast → live i ÉN transaktion. To
-- separate kald fra appen ville, hvis det andet fejlede, efterlade (type, kanal) helt uden
-- live skabelon — og dermed uden udsendelse. SECURITY INVOKER; kun service-role må kalde den
-- (revoke nedenfor) — admin-actionen står for rolletjekket.
create function publish_notification_template(p_template_id uuid, p_published_by uuid)
returns void
language plpgsql as $$
declare
  v_row notification_template%rowtype;
begin
  select * into v_row from notification_template where id = p_template_id for update;
  if not found then
    raise exception 'Skabelonen findes ikke.';
  end if;
  if v_row.status <> 'udkast' then
    raise exception 'Kun et udkast kan publiceres.';
  end if;

  update notification_template
     set status = 'arkiveret', updated_at = now()
   where type_key = v_row.type_key and channel = v_row.channel and status = 'live';

  update notification_template
     set status = 'live', published_at = now(), published_by = p_published_by, updated_at = now()
   where id = p_template_id;
end $$;

-- Supabase eksponerer nye public-funktioner som /rest/v1/rpc/<navn> for anon/authenticated
-- (default privileges, ADR 0047). Publicering er en admin-handling via service-role, så den
-- rettighed fjernes — samme guardede revoke som 0016.
do $$
declare
  fn text := 'public.publish_notification_template(uuid, uuid)';
begin
  execute format('revoke all on function %s from public', fn);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %s from anon', fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %s from authenticated', fn);
  end if;
end $$;

-- Udsendelseslog. INGEN persondata i klartekst: modtageren er `recipient_user_id` (en
-- reference), aldrig en e-mailadresse eller et telefonnummer — adressen slås op server-side
-- i det øjeblik der sendes og gemmes ikke her. `error` skrubbes for adresser før skrivning
-- (src/server/notifications/scrub.ts). Rækken følger brugeren ved sletning (cascade).
--
-- `idempotency_key` er unik: `type:related_id:recipient:channel[:diskriminator]`. Rækken
-- skrives FØR afsendelsen (status 'afventer') — den unikke constraint er claimet, så to
-- samtidige kørsler aldrig sender den samme besked to gange. Statussen 'stub'/'demo' betyder
-- at kanalen ikke var en rigtig adapter; intet nåede en rigtig modtager.
create table notification_delivery (
  id uuid primary key default gen_random_uuid(),
  type_key text not null check (type_key ~ '^[a-z][a-z0-9-]*$'),
  channel notification_channel not null,
  recipient_user_id uuid not null references app_user(id) on delete cascade,
  related_id uuid,                                   -- fx meeting_id; ingen FK (generisk)
  template_id uuid references notification_template(id),   -- versionen der blev brugt
  status notification_delivery_status not null default 'afventer',
  attempt int not null default 0 check (attempt >= 0),      -- forsøg på ledningen
  error text,
  provider_ref text,                                 -- leverandørens (eller DEMO-) besked-id
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_delivery_created_idx on notification_delivery (created_at desc);
create index notification_delivery_related_idx on notification_delivery (related_id);

-- --- RLS ---
alter table notification_template enable row level security;
alter table notification_delivery enable row level security;

-- Driftsdata: kun admin læser. INGEN write-policies — writes via service-role bag
-- requireRole('admin') (skabeloner) eller motoren (log), mønster fra 0009/0012/0013.
drop policy if exists notification_template_select_admin on notification_template;
create policy notification_template_select_admin on notification_template
  for select using (has_role('admin'));

drop policy if exists notification_delivery_select_admin on notification_delivery;
create policy notification_delivery_select_admin on notification_delivery
  for select using (has_role('admin'));
