-- Fase 1-fundament — kompetence-tags (delt af quiz §1.2 og partner-katalog §1.4) + has_role-helper.
-- Navnekonvention jf. ADR 0006. RLS-mønster jf. ADR 0007 (policies i supabase/policies/).

-- has_role: SECURITY DEFINER så RLS-policies kan tjekke brugerens rolle uden at læne sig på
-- select-egne-synlighed og uden rekursion. Genbruges af alle admin-gated forretningstabeller
-- (competence_tag her, partner_profile i 1.4 osv.). auth.uid() er schema-kvalificeret, så den
-- virker uanset search_path (Supabase i prod; auth-shim i test).
create or replace function public.has_role(check_role user_role)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from public.user_role_assignment
    where user_id = auth.uid() and role = check_role
  );
$$;

create table competence_tag (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS aktiv fra første forretningstabel (arkitekturprincip 5). Policies i supabase/policies/.
alter table competence_tag enable row level security;

-- Kanonisk taksonomi (byggespec §5.2). Admin ejer og kan redigere tags — dette er blot
-- fornuftige defaults, så quiz og katalog starter med den aftalte pulje.
-- Slugs følger slugify() (src/server/tags/slug.ts), så seedede og admin-oprettede tags matcher.
insert into competence_tag (slug, label, sort_order) values
  ('fastholdelse-og-churn',           'Fastholdelse og churn',            1),
  ('prissaetning-og-pakker',          'Prissætning og pakker',            2),
  ('salg-og-marketing',               'Salg og marketing',                3),
  ('oekonomi-og-noegletal',           'Økonomi og nøgletal',              4),
  ('positionering-og-kommunikation',  'Positionering og kommunikation',   5),
  ('skalering-funding-og-exit',       'Skalering, funding og exit',       6),
  ('tech-automatisering-og-ai',       'Tech, automatisering og AI',       7),
  ('udland-nye-markeder',             'Udland/nye markeder',              8)
on conflict (slug) do nothing;
