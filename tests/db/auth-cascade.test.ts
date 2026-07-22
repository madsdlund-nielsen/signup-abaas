import { describe, expect, it } from "vitest";
import { asPostgres } from "./helpers";

// Migration 0004: sletning af en auth.users-række skal fjerne den matchende app_user og
// cascade til user_role_assignment (+ board). Uden det efterlades forældreløse rækker.
const UID = "00000000-0000-0000-0000-00000000cade";

describe("auth-bruger-sletning → cascade (0004)", () => {
  it("fjerner app_user og rolletildeling når auth.users-rækken slettes", async () => {
    const result = await asPostgres(async (client) => {
      await client.query("insert into auth.users (id) values ($1)", [UID]);
      await client.query("insert into app_user (id, email) values ($1, $2)", [UID, "cade@x.dk"]);
      await client.query("insert into user_role_assignment (user_id, role) values ($1, 'ejer')", [
        UID,
      ]);

      await client.query("delete from auth.users where id = $1", [UID]);

      const users = await client.query("select 1 from app_user where id = $1", [UID]);
      const roles = await client.query("select 1 from user_role_assignment where user_id = $1", [
        UID,
      ]);
      return { users: users.rowCount ?? 0, roles: roles.rowCount ?? 0 };
    });

    expect(result.users).toBe(0);
    expect(result.roles).toBe(0);
  });

  it("efterlader ikke-relaterede app_user-rækker urørt", async () => {
    const other = "00000000-0000-0000-0000-00000000beef";
    const remaining = await asPostgres(async (client) => {
      await client.query("insert into auth.users (id) values ($1), ($2)", [UID, other]);
      await client.query("insert into app_user (id, email) values ($1, 'a@x.dk'), ($2, 'b@x.dk')", [
        UID,
        other,
      ]);

      await client.query("delete from auth.users where id = $1", [UID]);

      const res = await client.query("select 1 from app_user where id = $1", [other]);
      return res.rowCount ?? 0;
    });

    expect(remaining).toBe(1);
  });
});
