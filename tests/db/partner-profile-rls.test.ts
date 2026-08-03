import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

// Seed (tests/setup/seed.sql): to admin-forfattede partner-profiler (e0001 intern, e0002 ekstern)
// + én tag-kobling (e0001 → salg-og-marketing). Kun admin har adgang i 1.4.
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
};
const PROFILE = "00000000-0000-0000-0000-0000000e0001";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("partner_profile RLS (0009) — kun admin i 1.4", () => {
  it("admin ser alle profiler og tag-koblinger", async () => {
    expect(await countAs(USER.adminD, "select id from partner_profile")).toBe(2);
    expect(
      await countAs(USER.adminD, "select partner_profile_id from partner_profile_competence_tag"),
    ).toBe(1);
  });

  it("NEGATIV: ejer ser ingen profiler eller koblinger", async () => {
    expect(await countAs(USER.ejerA, "select id from partner_profile")).toBe(0);
    expect(
      await countAs(USER.ejerA, "select partner_profile_id from partner_profile_competence_tag"),
    ).toBe(0);
  });

  it("NEGATIV: partner-rolle ser intet katalog (ingen partner-adgang i 1.4)", async () => {
    expect(await countAs(USER.partnerB, "select id from partner_profile")).toBe(0);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null, "select id from partner_profile")).toBe(0);
  });

  it("NEGATIV: ingen kan indsætte en profil via RLS (writes kun via service-role)", async () => {
    // Hverken ejer eller admin har en write-policy → RLS blokerer; admin-writes går via service-role.
    await expect(
      asUser(USER.adminD, (client) =>
        client.query("insert into partner_profile (name) values ('Snyd')"),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query("insert into partner_profile (name) values ('Snyd')"),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ingen kan koble et tag til en partner via RLS", async () => {
    await expect(
      asUser(USER.adminD, (client) =>
        client.query(
          `insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
             select '${PROFILE}', id from competence_tag limit 1`,
        ),
      ),
    ).rejects.toThrow();
  });
});
