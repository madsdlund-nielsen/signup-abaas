import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asPostgres } from "./helpers";

/**
 * Demodata til ejer-test (`supabase/seed/demo.sql`). Filen køres manuelt mod et rigtigt
 * Supabase-projekt, så den ville ellers først blive syntakstjekket når Mads kører den.
 * Her anvendes den i en transaktion der rulles tilbage (`asPostgres`), så CI fanger både
 * SQL-fejl og at indholdet faktisk er brugbart for matchingen.
 *
 * `begin;`/`commit;` strippes: filen kører i sin egen transaktion i produktion, men her
 * ligger vi allerede inde i en — et `commit` ville committe testens rollback-transaktion.
 */
const DEMO_PREFIX = "d0000000-0000-4000-8000-%";

function sqlWithoutTransaction(file: string): string {
  return readFileSync(join(process.cwd(), "supabase", "seed", file), "utf8")
    .replace(/^\s*begin;\s*$/gim, "")
    .replace(/^\s*commit;\s*$/gim, "");
}

const SEED = sqlWithoutTransaction("demo.sql");
const CLEAN = sqlWithoutTransaction("demo-clean.sql");

describe("demo-seed (supabase/seed/demo.sql)", () => {
  it("kan anvendes og giver en publiceret quiz + et partnerkatalog", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);

      const { rows } = await client.query(
        `select
           (select count(*) from quiz_question   where id::text like $1 and is_published) as spoergsmaal,
           (select count(*) from quiz_option     where id::text like $1) as options,
           (select count(*) from partner_profile where id::text like $1) as partnere`,
        [DEMO_PREFIX],
      );
      expect(Number(rows[0].spoergsmaal)).toBe(2);
      expect(Number(rows[0].options)).toBe(12);
      expect(Number(rows[0].partnere)).toBe(6);
    });
  });

  it("frekvens-spørgsmålet giver præcis 4, 8 og 12 uger", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      const { rows } = await client.query(
        `select frequency_weeks from quiz_option
          where id::text like $1 and kind = 'frequency' order by frequency_weeks`,
        [DEMO_PREFIX],
      );
      expect(rows.map((r) => r.frequency_weeks)).toEqual([4, 8, 12]);
    });
  });

  it("hvert kompetence-tag er dækket af mindst én demopartner — ellers kan matchingen ikke matche", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      const { rows } = await client.query(
        `select t.slug from competence_tag t
          where not exists (
            select 1 from partner_profile_competence_tag pct
            where pct.competence_tag_id = t.id and pct.partner_profile_id::text like $1
          )`,
        [DEMO_PREFIX],
      );
      expect(rows.map((r) => r.slug)).toEqual([]);
    });
  });

  it("hver tag-svarmulighed peger på et kompetence-tag", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      const { rows } = await client.query(
        `select o.id from quiz_option o
          where o.id::text like $1 and o.kind = 'tag'
            and not exists (
              select 1 from quiz_option_competence_tag m where m.quiz_option_id = o.id
            )`,
        [DEMO_PREFIX],
      );
      expect(rows).toEqual([]);
    });
  });

  it("seeder ALDRIG prisregler — beløb er ejer-territorium (stub-politik)", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      const { rows } = await client.query("select count(*) as antal from pricing_rule");
      expect(Number(rows[0].antal)).toBe(0);
    });
  });

  it("er idempotent — to kørsler giver samme antal rækker", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      await client.query(SEED);
      const { rows } = await client.query(
        `select
           (select count(*) from quiz_option     where id::text like $1) as options,
           (select count(*) from partner_profile where id::text like $1) as partnere`,
        [DEMO_PREFIX],
      );
      expect(Number(rows[0].options)).toBe(12);
      expect(Number(rows[0].partnere)).toBe(6);
    });
  });

  it("demo-clean fjerner alt igen (og koblingerne cascader)", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      await client.query(CLEAN);
      const { rows } = await client.query(
        `select
           (select count(*) from quiz_question              where id::text like $1) as spoergsmaal,
           (select count(*) from quiz_option                where id::text like $1) as options,
           (select count(*) from partner_profile            where id::text like $1) as partnere,
           (select count(*) from partner_profile_competence_tag
              where partner_profile_id::text like $1) as koblinger`,
        [DEMO_PREFIX],
      );
      expect(Object.values(rows[0]).map(Number)).toEqual([0, 0, 0, 0]);
    });
  });
});
