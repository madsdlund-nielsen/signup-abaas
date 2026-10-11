-- Cal.com collective event type pr. board (ADR 0046, backlog B-23). Naming: ADR 0006.
-- RLS: ADR 0007 — ingen nye policies, bevidst.
--
-- Multi-host realiseres som ÉT collective team event type pr. board (værter hører til event
-- typen, ikke til bookingen — API v2 har intet `hosts`-felt på POST /v2/bookings). Det gør
-- Cal.coms id'er til TILSTAND i Supabase, ikke konfiguration:
--
--   board.calcom_event_type_id    boardets collective event type hos Cal.com (null = ikke oprettet
--                                 endnu → booking fejler højlydt i rigtig tilstand).
--   partner_profile.calcom_user_id partnerens Cal.com-bruger (Teams-sæde). Det tredje identitetsled
--                                 efter katalogpost ↔ auth-bruger (ADR 0025): værterne på event
--                                 typen navngives med Cal.com-bruger-id, ikke Supabase-UUID.
--
-- Begge er nullable og sat af admin via service-role bag requireRole('admin'). Ingen nye
-- read-policies: kolonnerne arver præcis de rækker boardet/profilen allerede er synlig for
-- (board_select_owner/partner/admin, partner_profile_select_admin/self/board_member). Ingen
-- write-policies findes på hverken board eller partner_profile → hverken ejer eller partner kan
-- opdatere dem via RLS (negativ-case i tests/db/calcom-collective-rls.test.ts).
--
-- Cal.com-id'er er heltal. En unik indeks forhindrer at to boards deler et event type, og at to
-- katalogposter peger på samme Cal.com-sæde (en dobbelt-tildeling ville booke den forkerte vært).

alter table board
  add column if not exists calcom_event_type_id integer
    check (calcom_event_type_id is null or calcom_event_type_id > 0);

alter table partner_profile
  add column if not exists calcom_user_id integer
    check (calcom_user_id is null or calcom_user_id > 0);

create unique index if not exists board_calcom_event_type_id_key
  on board (calcom_event_type_id) where calcom_event_type_id is not null;

create unique index if not exists partner_profile_calcom_user_id_key
  on partner_profile (calcom_user_id) where calcom_user_id is not null;
