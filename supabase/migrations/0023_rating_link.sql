-- Fase 4.2 / backlog B-21 — signerede engangslinks til rating (byggespec §8, ADR 0060).
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent).
--
-- Et rating-link er en AUTH-FRI skrivevej: den der holder linket kan gemme én vurdering uden at
-- være logget ind. Sikkerheden ligger derfor i tre lag, og dette er det nederste:
--   1. Linket bærer en HMAC-signatur (src/server/ratings/link.ts) — uden `RATING_LINK_SECRET`
--      kan hverken et link udstedes eller indløses (fail-closed).
--   2. Rækken her er den eneste sandhed om om linket stadig kan bruges.
--   3. ENGANGSBRUGEN håndhæves atomisk i basen af `redeem_rating_link` nedenfor — ikke i koden.
--
-- Rækken indeholder ingen ny persondata: kun referencer (mødet og raten) som `meeting_rating`
-- allerede holder. Selve tokenet gemmes ALDRIG — det genskabes af id + signatur (HMAC over
-- rækken), så en læk af tabellen ikke kan give et gyldigt link.

create table rating_link (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,

  -- Hvem linket vurderer SOM. Spejler `meeting_rating` (0015) 1:1: ejeren er en auth-bruger,
  -- partneren en katalogpost (ADR 0021). Præcis én sat — samme check som ratingen selv.
  rater_user_id uuid references app_user(id) on delete cascade,
  rater_partner_profile_id uuid references partner_profile(id) on delete cascade,

  -- Sat af koden ved udstedelse. Der er bevidst INGEN default: levetiden er et ejer-spørgsmål
  -- (TODO(ejer): linkets levetid, ADR 0060), og en default i basen ville gøre et teknisk tal
  -- til en stille forretningsregel.
  expires_at timestamptz not null,
  -- Sættes præcis én gang, af `redeem_rating_link`. Null = endnu ikke brugt.
  used_at timestamptz,
  created_at timestamptz not null default now(),

  constraint rating_link_one_rater
    check (num_nonnulls(rater_user_id, rater_partner_profile_id) = 1),

  -- Ét link pr. rater pr. møde. Ratinganmodningen sendes højst én gang pr. modtager (idempotens-
  -- nøglen i notifikationsmotoren, ADR 0057), men en kørsel der gentages må ikke hobe rækker op:
  -- udstedelsen er "find eller opret", og tokenet kan genskabes af rækken.
  -- `nulls not distinct` (PG 15+) af samme grund som på meeting_rating.
  constraint rating_link_unique_per_rater
    unique nulls not distinct (meeting_id, rater_user_id, rater_partner_profile_id)
);

create index rating_link_meeting_idx on rating_link (meeting_id);

-- --- RLS ---------------------------------------------------------------------------------

alter table rating_link enable row level security;

-- Kun admin læser (driftsoverblik: er anmodningerne gået ud, er de brugt?). INGEN policy for
-- ejer/partner/anon: linket bæres af sin signatur, ikke af en session, og ingen session skal
-- kunne opremse andres links. INGEN write-policies — udstedelse og indløsning sker via
-- service-role (src/server/ratings/link-*.ts), indløsningen gennem funktionen nedenfor.
drop policy if exists rating_link_select_admin on rating_link;
create policy rating_link_select_admin on rating_link
  for select using (has_role('admin'));

-- --- Atomisk indløsning ------------------------------------------------------------------

-- Indløs et link OG gem vurderingen i ÉN transaktion (en plpgsql-funktion er én). Returnerer
-- vurderingens id, eller NULL hvis linket ikke (længere) kan bruges.
--
-- Engangsbrugen sidder i det betingede UPDATE: `used_at is null and expires_at > now()`.
-- To samtidige kald låser samme række; det andet genvurderer WHERE efter det første har
-- committet (READ COMMITTED), ser `used_at` sat og rammer ingen række → NULL. Kun ét kald
-- kan altså nogensinde nå INSERT'en. Fordi INSERT og UPDATE er i samme transaktion, brænder
-- et link ALDRIG uden at have gemt en vurdering: fejler INSERT'en (fx ugyldig score), rulles
-- `used_at` tilbage med den.
--
-- Berettigelsen genprøves ved indløsning, ikke kun ved udstedelse (0015-reglerne, som
-- resolveRater/requireHeldMeeting i src/server/ratings/actions.ts): mødet skal stadig være
-- AFHOLDT, og raten skal stadig være ejer af boardet / deltagende partner. Et link til et
-- møde der siden er aflyst, eller en partner der er fjernet, brændes ikke — det afvises.
--
-- SECURITY INVOKER: kaldes kun med service-role (revoke nedenfor), som i forvejen omgår RLS.
-- Funktionen giver ingen ekstra rettigheder; den samler blot tre trin atomisk.
-- Vurderingen gælder mødet som helhed (subject = null). En vurdering af den enkelte rådgiver
-- kræver et valg pr. rådgiver og hører til den indloggede flade (/moeder/[id]).
create function redeem_rating_link(p_link_id uuid, p_score smallint, p_comment text)
returns uuid
language plpgsql as $$
declare
  v_link rating_link%rowtype;
  v_rating_id uuid;
begin
  update rating_link l
     set used_at = now()
   where l.id = p_link_id
     and l.used_at is null
     and l.expires_at > now()
     and exists (
       select 1 from meeting m
       where m.id = l.meeting_id and m.status = 'afholdt'
     )
     and (
       (l.rater_user_id is not null and exists (
         select 1 from meeting m join board b on b.id = m.board_id
         where m.id = l.meeting_id and b.owner_id = l.rater_user_id
       ))
       or
       (l.rater_partner_profile_id is not null and exists (
         select 1 from meeting_partner mp
         where mp.meeting_id = l.meeting_id
           and mp.partner_profile_id = l.rater_partner_profile_id
       ))
     )
  returning * into v_link;

  if not found then
    return null;
  end if;

  insert into meeting_rating (
    meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id, score, comment
  ) values (
    v_link.meeting_id, v_link.rater_user_id, v_link.rater_partner_profile_id, null,
    p_score, nullif(btrim(p_comment), '')
  )
  -- Samme upsert som den indloggede vurdering (submitRating): en vurdering afgivet via login
  -- opdateres frem for at give en dublet.
  on conflict on constraint meeting_rating_unique_per_subject
  do update set score = excluded.score, comment = excluded.comment, updated_at = now()
  returning id into v_rating_id;

  return v_rating_id;
end $$;

-- Supabase eksponerer nye public-funktioner som /rest/v1/rpc/<navn> for anon/authenticated
-- (default privileges, ADR 0047). Netop DENNE funktion må ALDRIG kunne kaldes derfra: den ville
-- gøre linket til et åbent endpoint uden signaturtjekket. Kun service-role (via
-- src/server/ratings/link-store.ts, bag HMAC-verifikationen) må kalde den — samme guardede
-- revoke som 0016/0021.
do $$
declare
  fn text := 'public.redeem_rating_link(uuid, smallint, text)';
begin
  execute format('revoke all on function %s from public', fn);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %s from anon', fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %s from authenticated', fn);
  end if;
end $$;

-- Tabellen: ingen skriverettigheder for klientrollerne som sikkerhedsnet oven på RLS (som
-- ovenfor ville en manglende policy allerede afvise dem). `select` forbliver, så admin-
-- policyen virker; for alle andre filtrerer RLS alt væk.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table rating_link from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke insert, update, delete, truncate on table rating_link from authenticated';
  end if;
end $$;
