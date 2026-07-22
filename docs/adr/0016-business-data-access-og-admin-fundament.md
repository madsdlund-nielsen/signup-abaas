# 0016 — Business-data-access-mønster + admin-fundament + has_role

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** nej.

## Kontekst

Fase 1's features (quiz §1.2, partner-katalog §1.4) deler samme forudsætninger: et rolle-gated
admin-område, et mønster for at læse/skrive forretningsdata i Supabase, og en delt
kompetence-tag-taksonomi. Før 1.1 fandtes intet af det — kun auth rørte Supabase. Vi etablerer
fundamentet nu, forankret på den ægte delte entitet `competence_tag`, så mønstrene valideres af en
konkret forbruger frem for at være spekulativ infrastruktur.

## Overvejede muligheder

- **Fundament som egen slice, forankret på competence_tag** (valgt) — admin-guard + data-access +
  `has_role()` bygges og testes for sig, med tag-administration som første forbruger. 1.2/1.4 bygger ovenpå.
- Byg fundamentet skjult inde i første feature (fx 1.4) — gør infrastrukturen usynlig og utestbar for sig.
- Ren infra uden entitet — spekulativt; risiko for forkerte abstraktioner uden en forbruger.

## Beslutning

**Business-data-access-mønster:**
- **Læsning** sker via den authed server-klient (`createServerSupabase`, RLS-håndhævet), så kun det
  brugeren må se returneres. Ukonfigureret Supabase → tom liste (kontofri CI/dev rendrer stadig).
  Se `src/server/tags/index.ts` (`listTags`).
- **Skrivning** (admin) sker via service-role (`createServiceSupabase`, bypasser RLS) bag et
  app-lags `requireRole(user,'admin')`-check, med `.select()` på hver skrivning som verify-readback
  (fanger tavse fejl, jf. `provisionOwner`). Se `src/server/tags/actions.ts`.
- Supabase er sandhedskilde og forespørges direkte server-side — ikke bag en adapter/port (ADR 0004
  gælder tredjeparts-SDK'er, ikke Supabase).

**Admin-fundament:** `src/app/admin/layout.tsx` guarder hele `/admin`: ikke logget ind → `/login`,
uden admin-rolle → `/dashboard`. Første rolle-gated overflade; mønster for al fremtidig admin.

**`has_role(check_role user_role)`** SECURITY DEFINER-funktion (migration 0005) bruges i RLS-policies
til rolletjek uden rekursion/afhængighed af select-egne-synlighed (spec §3/§6). Genbruges af 1.2/1.4.

**`competence_tag`** (0005): admin-styret, RLS `select` for authenticated, skriv via service-role
(ingen write-policy — samme mønster som roles/board). Seedes med §5.2-taksonomien som redigerbar default.

## Konsekvenser

- Positive: genbrugeligt læse/skrive-mønster + admin-guard + `has_role` på plads; 1.2 og 1.4 bygger
  direkte ovenpå i dokumenteret rækkefølge; RLS + guard er dobbelt værn.
- Negative / pris: admin-skriv beror app-lags-rollecheck (service-role bypasser RLS) — derfor er
  `requireRole` + guard obligatoriske på alle admin-skrive-stier.
- Opfølgning (senere faser): `partner_profile` + partner-katalog (1.4), quiz-entiteter + tag-mapping
  (1.2), foto-upload til Supabase Storage, offentlige profilsider, fejl/validerings-UX (ingen rød
  brandfarve endnu — ejer-beslutning, flagget i `components.css`).
