-- Fase 4.1 + 4.2 — forberedelse og rating. Byggespec §4 (75 min honorargrundlag), §5.6 og §6.
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent). Datamodelvalg: ADR 0038.
--
-- Tre tabeller, tre forskellige synligheds-regimer — bevidst, ikke tilfældigt:
--   * meeting_agenda_item  DELT   — ejerens dagsorden er hele grunden til at partneren kan
--                                   forberede sig; uden delt synlighed har modulet ingen funktion.
--   * meeting_prep_note    PRIVAT — partnerens eget arbejdsrum. Ejeren ser den IKKE.
--   * meeting_rating       PRIVAT — kun den der har afgivet vurderingen, plus admin.

-- --- 4.1 Forberedelse -------------------------------------------------------------------

-- Ejerens forberedelse: dagsorden, spørgsmål til boardet, og henvisning til materiale.
-- Ét enum frem for tre tabeller: felterne er identiske, og rækkefølgen er brugerens.
-- Materiale er TEKST (link/beskrivelse), ikke upload — fil-upload er ikke i fase 4's DoD,
-- og en halv upload-implementering ville være et gæt om opbevaring, GDPR-sletteflow og
-- virusscanning. TODO(mads): filupload til materiale hvis ejerne efterspørger det.
create type agenda_item_kind as enum ('dagsorden', 'spoergsmaal', 'materiale');

create table meeting_agenda_item (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,
  kind agenda_item_kind not null,
  body text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meeting_agenda_item_meeting_idx on meeting_agenda_item (meeting_id);

-- Partnerens forberedelsesrum — modstykket til de 15 betalte minutter (meeting.prep_minutes,
-- 0012). Én pr. partner pr. møde: forberedelse er ét dokument, ikke en tråd.
--
-- Synlighed: RESTRIKTIV og snævrere end meeting_note (0012), som ejeren KAN se. En
-- efter-møde-note er en leverance til ejeren; en forberedelsesnote er partnerens eget
-- arbejdsrum, og det er ikke afgjort om ejeren skal kunne læse med. Vi vælger det
-- restriktive frem for at gætte.
-- TODO(ejer): note-synlighed — gælder også denne tabel. Udvidelse er én policy.
create table meeting_prep_note (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, partner_profile_id)
);

create index meeting_prep_note_meeting_idx on meeting_prep_note (meeting_id);

-- --- 4.2 Rating -------------------------------------------------------------------------

-- Én række pr. (rater, subjekt) pr. møde.
--
-- To identitetstyper i samme tabel, fordi begge parter rater: ejeren er en auth-bruger,
-- partneren er en katalogpost (ADR 0021 — en partner ER ikke sin auth-bruger). Præcis én
-- af de to kolonner er sat; check-constrainten håndhæver det i basen frem for i koden.
--
-- subject_partner_profile_id: null = vurdering af MØDET som helhed; sat = vurdering af den
-- enkelte partner. Det er den kolonne "aggregering pr. partner" (fase 4.2) læser.
--
-- Ratings har BEVIDST ingen konsekvens i koden. Byggespec §5.2 nævner rating som mulig
-- tie-break i board-matchingen, men den regel er uafklaret (docs/fase-1-rapport.md, B-07),
-- og matching-algoritmen må ikke læse denne tabel før ejeren har besluttet det.
-- TODO(ejer): hvad ratings bruges til (matching? udskiftning?) — lagring og admin-visning
-- er alt hvad der bygges her.
create table meeting_rating (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,

  -- Hvem vurderer. Præcis én sat.
  rater_user_id uuid references app_user(id) on delete cascade,
  rater_partner_profile_id uuid references partner_profile(id) on delete cascade,

  -- Hvad der vurderes. Null = mødet som helhed.
  subject_partner_profile_id uuid references partner_profile(id) on delete cascade,

  -- 1-5. Skalaen er strukturel, ikke et forretningstal: den udtrykker "hurtigt format,
  -- besvares på under et minut" (fase 4.2), ikke en sats nogen skal godkende.
  score smallint not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meeting_rating_one_rater
    check (num_nonnulls(rater_user_id, rater_partner_profile_id) = 1),

  -- `nulls not distinct` (PG 15+) er nødvendig: uden den ville to møde-vurderinger fra
  -- samme rater (subject = null) tælle som forskellige rækker, og gentagne indsendelser
  -- ville hobe sig op i stedet for at opdatere.
  constraint meeting_rating_unique_per_subject
    unique nulls not distinct
      (meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id)
);

create index meeting_rating_meeting_idx on meeting_rating (meeting_id);
-- Til aggregering pr. partner (admin-visning). Partiel: møde-vurderinger indgår ikke.
create index meeting_rating_subject_idx on meeting_rating (subject_partner_profile_id)
  where subject_partner_profile_id is not null;

-- --- RLS ---------------------------------------------------------------------------------

alter table meeting_agenda_item enable row level security;
alter table meeting_prep_note enable row level security;
alter table meeting_rating enable row level security;

-- meeting_agenda_item: DELT — ejer (via board), partner på boardet, admin.
drop policy if exists meeting_agenda_item_select_owner on meeting_agenda_item;
create policy meeting_agenda_item_select_owner on meeting_agenda_item
  for select using (
    exists (
      select 1 from meeting m join board b on b.id = m.board_id
      where m.id = meeting_agenda_item.meeting_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists meeting_agenda_item_select_partner on meeting_agenda_item;
create policy meeting_agenda_item_select_partner on meeting_agenda_item
  for select using (
    exists (
      select 1 from meeting m
      where m.id = meeting_agenda_item.meeting_id and is_partner_on_board(m.board_id)
    )
  );

drop policy if exists meeting_agenda_item_select_admin on meeting_agenda_item;
create policy meeting_agenda_item_select_admin on meeting_agenda_item
  for select using (has_role('admin'));

-- meeting_prep_note: PRIVAT — kun forfatteren og admin. Ejeren er bevidst udeladt.
drop policy if exists meeting_prep_note_select_author on meeting_prep_note;
create policy meeting_prep_note_select_author on meeting_prep_note
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = meeting_prep_note.partner_profile_id and pp.app_user_id = auth.uid()
    )
  );

drop policy if exists meeting_prep_note_select_admin on meeting_prep_note;
create policy meeting_prep_note_select_admin on meeting_prep_note
  for select using (has_role('admin'));

-- meeting_rating: PRIVAT — kun den der afgav vurderingen, plus admin.
-- Den VURDEREDE partner ser IKKE sin egen score. Fase 4.2: aggregering pr. partner er
-- datagrundlag, "ikke en offentlig score" — og indtil ejeren har besluttet hvad ratings
-- bruges til, ville en synlig score foregribe den beslutning.
drop policy if exists meeting_rating_select_rater_owner on meeting_rating;
create policy meeting_rating_select_rater_owner on meeting_rating
  for select using (rater_user_id = auth.uid());

drop policy if exists meeting_rating_select_rater_partner on meeting_rating;
create policy meeting_rating_select_rater_partner on meeting_rating
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = meeting_rating.rater_partner_profile_id and pp.app_user_id = auth.uid()
    )
  );

drop policy if exists meeting_rating_select_admin on meeting_rating;
create policy meeting_rating_select_admin on meeting_rating
  for select using (has_role('admin'));

-- Ingen write-policies på nogen af de tre tabeller: alle writes går via service-role bag
-- rolle- + ejerskabstjek i src/server/preparation og src/server/ratings (mønster fra 0012).
-- Det er også dér "mødet skal være afholdt før det kan vurderes" håndhæves — en regel der
-- krydser tabelgrænser og derfor ikke kan være en check-constraint.
