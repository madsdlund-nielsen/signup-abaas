import { describe, expect, it } from "vitest";
import { asPostgres } from "./helpers";

/**
 * Migration 0016 + ADR 0047 — hvem må kalde vores SECURITY DEFINER-funktioner.
 *
 * Supabase' linter flagger alle tre som "eksekverbar for anon/authenticated". Kun ÉN af dem
 * skal strammes; de to andre KALDES af RLS-policies og evalueres med kalderens rettigheder,
 * så et velment revoke ville lukke al authed læsning. Testen låser begge dele fast — den
 * negative (trigger-funktionen) og den positive (RLS-hjælperne).
 *
 * app_authenticated (tests/setup/seed.sql) får aldrig eksplicitte funktions-grants; den arver
 * kun via PUBLIC. Den er derfor en præcis prøve på om default-grant'et er væk.
 */
describe("SECURITY DEFINER-grants (0016)", () => {
  it("trigger-funktionen er ikke længere eksekverbar for app-rollen", async () => {
    const canExecute = await asPostgres(async (client) => {
      const exists = await client.query(
        "select to_regprocedure('public.handle_auth_user_deleted()') is not null as ok",
      );
      expect(exists.rows[0].ok).toBe(true);

      const res = await client.query(
        "select has_function_privilege('app_authenticated', 'public.handle_auth_user_deleted()', 'EXECUTE') as v",
      );
      return res.rows[0].v as boolean;
    });

    expect(canExecute).toBe(false);
  });

  it("cascade-triggeren fyrer stadig når sletningen udføres af en rolle uden EXECUTE", async () => {
    const uid = "00000000-0000-0000-0000-0000000acc10";

    const remaining = await asPostgres(async (client) => {
      await client.query("insert into auth.users (id) values ($1)", [uid]);
      await client.query("insert into app_user (id, email) values ($1, 'acl@x.dk')", [uid]);

      // Rulles tilbage med transaktionen sammen med resten.
      await client.query("grant select, delete on auth.users to app_authenticated");
      await client.query("set local role app_authenticated");
      await client.query("delete from auth.users where id = $1", [uid]);
      await client.query("set local role none");

      const res = await client.query("select 1 from app_user where id = $1", [uid]);
      return res.rowCount ?? 0;
    });

    expect(remaining).toBe(0);
  });

  it("RLS-hjælperne FORBLIVER eksekverbare — uden dem fejler enhver authed læsning", async () => {
    const privileges = await asPostgres(async (client) => {
      const res = await client.query(`
        select
          has_function_privilege('app_authenticated', 'public.has_role(user_role)', 'EXECUTE') as has_role,
          has_function_privilege('app_authenticated', 'public.is_partner_on_board(uuid)', 'EXECUTE') as is_partner
      `);
      return res.rows[0] as { has_role: boolean; is_partner: boolean };
    });

    expect(privileges.has_role).toBe(true);
    expect(privileges.is_partner).toBe(true);
  });
});
