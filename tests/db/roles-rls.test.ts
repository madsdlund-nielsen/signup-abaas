import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

// Samme seed-brugere som tests/setup/seed.sql.
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  adminD: "00000000-0000-0000-0000-00000000000d",
};

async function visibleRoleCount(viewer: string, target: string): Promise<number> {
  return asUser(viewer, async (client) => {
    const res = await client.query(
      "select role from user_role_assignment where user_id = $1",
      [target],
    );
    return res.rowCount ?? 0;
  });
}

async function visibleAppUserCount(viewer: string, target: string): Promise<number> {
  return asUser(viewer, async (client) => {
    const res = await client.query("select id from app_user where id = $1", [target]);
    return res.rowCount ?? 0;
  });
}

describe("RLS: rolle-tabeller (Supabase Auth, ADR 0013)", () => {
  it("bruger ser sine egne rolletildelinger", async () => {
    expect(await visibleRoleCount(USER.adminD, USER.adminD)).toBe(1);
  });

  it("bruger ser sin egen app_user-række", async () => {
    expect(await visibleAppUserCount(USER.ejerA, USER.ejerA)).toBe(1);
  });

  it("NEGATIV: bruger ser ikke en anden brugers roller", async () => {
    expect(await visibleRoleCount(USER.ejerA, USER.adminD)).toBe(0);
  });

  it("NEGATIV: bruger ser ikke en anden brugers app_user-række", async () => {
    expect(await visibleAppUserCount(USER.ejerA, USER.adminD)).toBe(0);
  });

  it("NEGATIV: bruger kan ikke selv-tildele en rolle (ingen insert-policy)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query("insert into user_role_assignment (user_id, role) values ($1, 'admin')", [
          USER.ejerA,
        ]),
      ),
    ).rejects.toThrow();
  });
});
