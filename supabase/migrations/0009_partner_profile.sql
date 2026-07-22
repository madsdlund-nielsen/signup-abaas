-- Fase 1.4 — partner-katalog (admin-forfattet). Byggespec §5.3, ADR 0019. Kataloget som 1.5-matching
-- filtrerer imod. Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i
-- migrationen, <tabel>_<operation>_<rolle>, idempotent). Mønster: admin ser alt; writes via service-
-- role (ingen write-policy). INGEN partner-policies → "tags er read-only for partner" (§1.4) er
-- håndhævet ved fravær; partner-login + self-service-profil er udskudt (TODO(mads), spores i Fase 2).

-- Kataloget er AFKOBLET fra auth (egen uuid-PK, ikke auth.uid()), så admin kan oprette katalogposter
-- uden at provisionere login-konti. Kun "sikre" felter bygges nu; pris/rating/møder/tilgængelighed
-- tilføjes i deres egne faser.
create table partner_profile (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,                                        -- titel/rolle
  is_internal boolean not null default true,         -- intern (fast) vs. ekstern/gæst; TODO(ejer): lead-partner regler
  languages text,                                    -- sprog
  personal_info text,                                -- personlig info
  short_bio text,
  long_bio text,
  photo_url text,                                    -- billede
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- TODO(ejer): honorarsats (🔴 pris — binder meeting-fee). Rating/antal-møder (fase 4),
  -- tilgængelighedsvindue (fase 5, Cal.com) tilføjes i deres faser.
);

-- Kobling partner → kompetence (byggespec §6 expert_skills). Dette er hvad 1.5 matching konsumerer
-- sammen med ejerens quiz-svar. Admin tildeler autoritativt (ingen partner-writes).
create table partner_profile_competence_tag (
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  competence_tag_id uuid not null references competence_tag(id) on delete cascade,
  primary key (partner_profile_id, competence_tag_id)
);

-- --- RLS ---
alter table partner_profile enable row level security;
alter table partner_profile_competence_tag enable row level security;

-- Kun admin ser/skriver kataloget i 1.4. Forward-compat: 1.5/1.6 tilføjer den ejer/authed read-policy
-- de skal bruge til board-visning (eksponér ikke katalog bredt før nødvendigt — GDPR).
drop policy if exists partner_profile_select_admin on partner_profile;
create policy partner_profile_select_admin on partner_profile
  for select using (has_role('admin'));

drop policy if exists partner_profile_competence_tag_select_admin on partner_profile_competence_tag;
create policy partner_profile_competence_tag_select_admin on partner_profile_competence_tag
  for select using (has_role('admin'));

-- Ingen write-policies: admin-writes går via service-role bag requireRole('admin').
