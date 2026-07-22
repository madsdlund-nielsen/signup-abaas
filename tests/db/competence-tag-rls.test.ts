import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

// Seed-brugere (tests/setup/seed.sql).
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  adminD: "00000000-0000-0000-0000-00000000000d",
};

async function visibleTagCount(sub: string | null): Promise<number> {
  return asUser(sub, async (client) => {
    const res = await client.query("select id from competence_tag");
    return res.rowCount ?? 0;
  });
}

async function hasAdminRole(sub: string): Promise<boolean> {
  return asUser(sub, async (client) => {
    const res = await client.query("select public.has_role('admin') as ok");
    return res.rows[0].ok === true;
  });
}

describe("competence_tag RLS + has_role (0005)", () => {
  it("authenticated kan læse den seedede taksonomi", async () => {
    expect(await visibleTagCount(USER.ejerA)).toBeGreaterThanOrEqual(8);
  });

  it("has_role('admin') er sand for admin-bruger", async () => {
    expect(await hasAdminRole(USER.adminD)).toBe(true);
  });

  it("NEGATIV: has_role('admin') er falsk for ikke-admin", async () => {
    expect(await hasAdminRole(USER.ejerA)).toBe(false);
  });

  it("NEGATIV: uden session ses ingen tags", async () => {
    expect(await visibleTagCount(null)).toBe(0);
  });

  it("NEGATIV: ikke-admin kan ikke indsætte tag (ingen write-policy → RLS blokerer)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query("insert into competence_tag (slug, label) values ('x', 'X')"),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ikke-admin kan ikke opdatere et tag (RLS → 0 rækker ramt)", async () => {
    const affected = await asUser(USER.ejerA, async (client) => {
      const res = await client.query(
        "update competence_tag set label = 'hack' where slug = 'salg-og-marketing'",
      );
      return res.rowCount ?? 0;
    });
    expect(affected).toBe(0);
  });
});
