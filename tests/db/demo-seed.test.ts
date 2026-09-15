import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
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
 * (Do-blokkens `begin`/`end` uden semikolon rammes ikke af regexen.)
 */
const DEMO_PREFIX = "d0000000-0000-4000-8000-%";
const DEMO_RULE_ID = "d0000000-0000-4000-8000-000000000601";

/** Ejer-E fra tests/setup/seed.sql: har rollen ejer og — afgørende — intet board. */
const OWNER_E = { id: "00000000-0000-0000-0000-00000000000e", email: "ejer-e@example.com" };
/** Ejer-A har allerede "A's board" i test-seed'et — negativ-case for den befolkede tilstand. */
const OWNER_A = { id: "00000000-0000-0000-0000-00000000000a", email: "ejer-a@example.com" };

function sqlWithoutTransaction(file: string): string {
  return readFileSync(join(process.cwd(), "supabase", "seed", file), "utf8")
    .replace(/^\s*begin;\s*$/gim, "")
    .replace(/^\s*commit;\s*$/gim, "");
}

const SEED = sqlWithoutTransaction("demo.sql");
const CLEAN = sqlWithoutTransaction("demo-clean.sql");

/** Sæt ejeren for den befolkede tilstand — som scriptet gør det, men transaktions-lokalt. */
async function seedAsOwner(client: Client, email: string): Promise<void> {
  await client.query("select set_config('demo.owner_email', $1, true)", [email]);
  await client.query(SEED);
}

/** Rækkerne i den befolkede tilstand (ADR 0043), alle i demo-serien. */
async function populatedCounts(client: Client): Promise<Record<string, number>> {
  const { rows } = await client.query(
    `select
       (select count(*) from board               where id::text like $1) as boards,
       (select count(*) from board_partner       where board_id::text like $1) as medlemmer,
       (select count(*) from membership          where id::text like $1 and card_status = 'registreret') as medlemskaber,
       (select count(*) from meeting             where id::text like $1) as moeder,
       (select count(*) from meeting_partner     where meeting_id::text like $1) as deltagere,
       (select count(*) from meeting_agenda_item where id::text like $1) as dagsorden,
       (select count(*) from meeting_note        where id::text like $1) as noter,
       (select count(*) from meeting_rating      where id::text like $1) as vurderinger,
       (select count(*) from payment_charge      where id::text like $1) as opkraevninger,
       (select count(*) from pricing_rule        where id::text like $1 and is_active) as demoregler,
       (select count(*) from quiz_answer         where id::text like $1) as svar`,
    [DEMO_PREFIX],
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

const EMPTY = {
  boards: 0,
  medlemmer: 0,
  medlemskaber: 0,
  moeder: 0,
  deltagere: 0,
  dagsorden: 0,
  noter: 0,
  vurderinger: 0,
  opkraevninger: 0,
  demoregler: 0,
  svar: 0,
};

const POPULATED = {
  boards: 1,
  medlemmer: 3,
  medlemskaber: 1,
  moeder: 2,
  deltagere: 6,
  dagsorden: 4,
  noter: 1,
  vurderinger: 2,
  opkraevninger: 1,
  demoregler: 1,
  svar: 4,
};

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

  it("uden DEMO_OWNER_EMAIL seedes hverken prisregel, board eller møder — præcis som før", async () => {
    await asPostgres(async (client) => {
      await client.query(SEED);
      const { rows } = await client.query("select count(*) as antal from pricing_rule");
      expect(Number(rows[0].antal)).toBe(0);
      expect(await populatedCounts(client)).toEqual(EMPTY);
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

/**
 * Befolket tilstand for en eksisterende ejer (ADR 0043). Seed'et kan ikke oprette
 * auth-brugere, så det hægter board, medlemskab og møder på en ejer valgt via
 * `demo.owner_email` — og nægter at blande demodata med rigtige.
 */
describe("demo-seed — befolket tilstand for en eksisterende ejer (ADR 0043)", () => {
  it("med ejer: board, demo-kort, to møder, dagsorden, note, vurderinger, opkrævning og demo-regel", async () => {
    await asPostgres(async (client) => {
      await seedAsOwner(client, OWNER_E.email);
      expect(await populatedCounts(client)).toEqual(POPULATED);

      const { rows: meetings } = await client.query(
        `select status, starts_at > now() as fremtid, video_join_url, provider_booking_uid
           from meeting where id::text like $1 order by starts_at`,
        [DEMO_PREFIX],
      );
      expect(meetings.map((m) => [m.status, m.fremtid])).toEqual([
        ["afholdt", false],
        ["planlagt", true],
      ]);
      // "Deltag" skal lande på appens demo-møderum — samme mønster som DemoBookingProvider.
      for (const m of meetings) expect(m.video_join_url).toBe(`/moeder/rum/${m.provider_booking_uid}`);

      const { rows: registered } = await client.query(
        `select count(*) as antal from meeting_partner mp join meeting m on m.id = mp.meeting_id
          where m.id::text like $1 and m.status = 'afholdt' and mp.registered_status = 'afholdt'`,
        [DEMO_PREFIX],
      );
      expect(Number(registered[0].antal)).toBe(3);

      const { rows: charge } = await client.query(
        `select amount_minor, currency, status, provider_charge_ref, pricing_rule_id
           from payment_charge where id::text like $1`,
        [DEMO_PREFIX],
      );
      // (100 + 3 × 100) × 1,0 = 400 øre — åbenlyst falsk, og samme formel som createChargeForMeeting.
      expect(charge[0]).toMatchObject({ amount_minor: 400, currency: "DKK", status: "rapporteret", pricing_rule_id: DEMO_RULE_ID });
      expect(charge[0].provider_charge_ref).toMatch(/^DEMO-CHARGE-/);

      const { rows: membership } = await client.query(
        `select provider_customer_ref from membership where id::text like $1`,
        [DEMO_PREFIX],
      );
      expect(membership[0].provider_customer_ref).toMatch(/^DEMO-CUSTOMER-/);

      const { rows: lead } = await client.query(
        `select count(*) as antal from board_partner where board_id::text like $1 and is_lead`,
        [DEMO_PREFIX],
      );
      expect(Number(lead[0].antal)).toBe(1);
    });
  });

  it("er idempotent med ejer — to kørsler giver samme antal rækker", async () => {
    await asPostgres(async (client) => {
      await seedAsOwner(client, OWNER_E.email);
      await client.query(SEED);
      expect(await populatedCounts(client)).toEqual(POPULATED);
    });
  });

  it("rører ikke prisregler når en aktiv regel findes — og seeder så ingen opkrævning", async () => {
    await asPostgres(async (client) => {
      // Rigtig regel i en transaktion der rulles tilbage: tallene er strukturelle, ikke forretning.
      await client.query(
        `insert into pricing_rule (version, base_amount_minor, per_partner_amount_minor,
           factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active) values (1, 0, 0, 1, 1, 1, true)`,
      );
      await seedAsOwner(client, OWNER_E.email);
      const counts = await populatedCounts(client);
      expect(counts).toEqual({ ...POPULATED, demoregler: 0, opkraevninger: 0 });
      const { rows } = await client.query("select count(*) as antal from pricing_rule");
      expect(Number(rows[0].antal)).toBe(1);
    });
  });

  it("fejler højlydt når e-mailen ikke findes i app_user", async () => {
    await asPostgres(async (client) => {
      await expect(seedAsOwner(client, "findes-ikke@example.com")).rejects.toThrow(/opret ejeren via \/signup/);
    });
  });

  it("afviser en ejer der allerede har et board — demodata må ikke blandes med rigtige", async () => {
    await asPostgres(async (client) => {
      await expect(seedAsOwner(client, OWNER_A.email)).rejects.toThrow(/allerede et board/);
    });
  });

  it("RLS: ejeren ser sine to demo-møder — en fremmed ejer ser ingen", async () => {
    await asPostgres(async (client) => {
      await seedAsOwner(client, OWNER_E.email);
      await client.query("set local role app_authenticated");

      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER_E.id]);
      const mine = await client.query(`select count(*) as antal from meeting where id::text like $1`, [DEMO_PREFIX]);
      expect(Number(mine.rows[0].antal)).toBe(2);

      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER_A.id]);
      const theirs = await client.query(`select count(*) as antal from meeting where id::text like $1`, [DEMO_PREFIX]);
      expect(Number(theirs.rows[0].antal)).toBe(0);
    });
  });

  it("demo-clean fjerner den befolkede tilstand, opkrævningen og demo-reglen", async () => {
    await asPostgres(async (client) => {
      await seedAsOwner(client, OWNER_E.email);
      await client.query(CLEAN);
      expect(await populatedCounts(client)).toEqual(EMPTY);
      const { rows } = await client.query("select count(*) as antal from pricing_rule where id = $1", [DEMO_RULE_ID]);
      expect(Number(rows[0].antal)).toBe(0);
    });
  });
});
