-- Fase 2 — møde-datamodel. Byggespec §5.4/§5.6/§6, ADR 0026 (to-felt-status) + ADR 0027
-- (webhook-ingest). Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007
-- (policies i migrationen, <tabel>_<operation>_<rolle>, idempotent). Supabase er
-- sandhedskilde (arkitekturprincip 1): mødet oprettes her FØRST, provider-referencen
-- (Cal.com) hægtes på bagefter.

-- To-felt-status (ADR 0026): mødets LIVSCYKLUS er app'ens tilstand (planlagt/aflyst/afholdt).
-- Partnerens REGISTRERING pr. møde (byggespec §5.6: "afholdt / forsinket afbud / udeblivelse")
-- er honorargrundlaget og bor på meeting_partner — ikke her.
create type meeting_status as enum ('planlagt', 'aflyst', 'afholdt');
create type meeting_registered_status as enum ('afholdt', 'forsinket_afbud', 'udeblivelse');

create table meeting (
  id uuid primary key default gen_random_uuid(),
  -- TODO(ejer): board-livscyklus — mødet er koblet til boardet, men hvornår et board
  -- "slutter" er uafklaret; ingen livscyklus-antagelser her.
  board_id uuid not null references board(id) on delete cascade,
  provider text not null default 'calcom',
  provider_booking_uid text unique,                  -- null indtil provider-booking findes
  starts_at timestamptz not null,
  duration_minutes int not null default 60,          -- fast 60 min i v1 (byggespec §4)
  -- Honorargrundlag = duration + prep = 75 min (byggespec §4/§5.10). KUN feltet — beregning
  -- og sats hører til fase 5. TODO(ejer): honorarsats.
  prep_minutes int not null default 15,
  status meeting_status not null default 'planlagt',
  -- TODO(ejer): ændre/aflyse-vindue (byggespec §12 pkt. 4) — intet vindue håndhæves her.
  video_join_url text,                               -- Cal Video-link, leveres af bookingen (§5.5)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meeting_board_idx on meeting (board_id);

-- Deltagende partnere pr. møde (byggespec §6 meeting_experts; her meeting_partner —
-- spejler board_partner). registered_status er PARTNERENS honorarregistrering (§5.6),
-- null indtil registreret. TODO(ejer): honorar ved udeblivelse/sent afbud — kun
-- registrering her, ingen beregnet konsekvens.
create table meeting_partner (
  meeting_id uuid not null references meeting(id) on delete cascade,
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  registered_status meeting_registered_status,
  registered_at timestamptz,
  primary key (meeting_id, partner_profile_id)
);

-- Efter-møde-noter, én pr. partner pr. møde (byggespec §6 meeting_notes).
-- TODO(ejer): note-synlighed — restriktiv default i RLS nedenfor (forfatter + board-ejer),
-- udvidelse er én policy når ejer beslutter. Noter UNDER møde er uafklaret og bygges ikke.
create table meeting_note (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, partner_profile_id)
);

-- Webhook-idempotens + audit-spor (ADR 0027): unik pr. provider-event → samme event
-- to gange muterer aldrig to gange. Rækken skrives af webhook-handleren (service-role)
-- FØR mutationen anvendes; unique-constrainten ER idempotensmekanismen.
create table meeting_webhook_event (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'calcom',
  provider_event_id text not null,
  event_type text not null,
  provider_booking_uid text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- --- RLS ---
alter table meeting enable row level security;
alter table meeting_partner enable row level security;
alter table meeting_note enable row level security;
alter table meeting_webhook_event enable row level security;

-- meeting: ejer (via board), deltagende partner (via is_partner_on_board, 0011), admin.
drop policy if exists meeting_select_owner on meeting;
create policy meeting_select_owner on meeting
  for select using (
    exists (select 1 from board b where b.id = meeting.board_id and b.owner_id = auth.uid())
  );

drop policy if exists meeting_select_partner on meeting;
create policy meeting_select_partner on meeting
  for select using (is_partner_on_board(meeting.board_id));

drop policy if exists meeting_select_admin on meeting;
create policy meeting_select_admin on meeting
  for select using (has_role('admin'));

-- meeting_partner: samme tre adgangsveje via mødet.
drop policy if exists meeting_partner_select_owner on meeting_partner;
create policy meeting_partner_select_owner on meeting_partner
  for select using (
    exists (
      select 1 from meeting m join board b on b.id = m.board_id
      where m.id = meeting_partner.meeting_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists meeting_partner_select_partner on meeting_partner;
create policy meeting_partner_select_partner on meeting_partner
  for select using (
    exists (
      select 1 from meeting m
      where m.id = meeting_partner.meeting_id and is_partner_on_board(m.board_id)
    )
  );

drop policy if exists meeting_partner_select_admin on meeting_partner;
create policy meeting_partner_select_admin on meeting_partner
  for select using (has_role('admin'));

-- meeting_note: RESTRIKTIV default (note-synlighed er ejer-uafklaret): forfatteren,
-- boardets ejer, og admin. Boardets ØVRIGE partnere ser IKKE noten endnu.
drop policy if exists meeting_note_select_author on meeting_note;
create policy meeting_note_select_author on meeting_note
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = meeting_note.partner_profile_id and pp.app_user_id = auth.uid()
    )
  );

drop policy if exists meeting_note_select_owner on meeting_note;
create policy meeting_note_select_owner on meeting_note
  for select using (
    exists (
      select 1 from meeting m join board b on b.id = m.board_id
      where m.id = meeting_note.meeting_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists meeting_note_select_admin on meeting_note;
create policy meeting_note_select_admin on meeting_note
  for select using (has_role('admin'));

-- meeting_webhook_event: driftsdata — kun admin læser. Writes kun via service-role.
drop policy if exists meeting_webhook_event_select_admin on meeting_webhook_event;
create policy meeting_webhook_event_select_admin on meeting_webhook_event
  for select using (has_role('admin'));

-- Ingen write-policies på nogen af tabellerne: alle writes går via service-role bag
-- rolle- + ejerskabstjek i src/server/meetings (mønster fra 0009/0010).
