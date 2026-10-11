import { describe, expect, it } from "vitest";
import type { Client } from "pg";

import { asPostgres, asUser } from "./helpers";

// Samme seed-brugere som tests/setup/seed.sql.
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};

const PROFILE_COLUMNS = "display_name, phone_e164, time_zone";

/** Kontoprofilen (0024, ADR 0061; SMS-samtykket fjernet i 0027, ADR 0065): kolonner på app_user, adgang via de eksisterende policies. */
describe("kontoprofil — standardværdier", () => {
  it("en eksisterende bruger har ingen forretningsværdier: intet navn, intet nummer", async () => {
    const row = await asUser(USER.ejerA, async (client) => {
      const res = await client.query(`select ${PROFILE_COLUMNS} from app_user where id = $1`, [USER.ejerA]);
      return res.rows[0];
    });
    expect(row).toEqual({
      display_name: null,
      phone_e164: null,
      time_zone: "Europe/Copenhagen",
    });
  });
});

/** Sæt data som DB-ejer (RLS bypasset), og kør derefter resten af transaktionen som en bruger. */
async function asUserWithData<T>(
  sub: string,
  seed: (client: Client) => Promise<void>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return asPostgres(async (client) => {
    await seed(client);
    await client.query("set local role app_authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    return fn(client);
  });
}

const seedEjerE = async (client: Client) => {
  await client.query(
    `update app_user set display_name = 'Ejer E', phone_e164 = '+4500000000'
       where id = $1`,
    [USER.ejerE],
  );
};

describe("RLS: kontoprofil (egen række + admin)", () => {
  it("brugeren læser sin egen profil, inkl. telefon", async () => {
    const row = await asUserWithData(USER.ejerE, seedEjerE, async (client) => {
      const res = await client.query(`select ${PROFILE_COLUMNS} from app_user where id = $1`, [USER.ejerE]);
      return res.rows[0];
    });
    expect(row).toMatchObject({ display_name: "Ejer E", phone_e164: "+4500000000" });
  });

  it("admin kan læse en brugers profil (indsigt, support)", async () => {
    const count = await asUserWithData(USER.adminD, seedEjerE, async (client) => {
      const res = await client.query("select phone_e164 from app_user where id = $1", [USER.ejerE]);
      return res.rows.filter((r) => r.phone_e164 === "+4500000000").length;
    });
    expect(count).toBe(1);
  });

  it("NEGATIV: en fremmed ejer kan ikke læse en andens navn eller telefonnummer", async () => {
    const rows = await asUserWithData(USER.ejerA, seedEjerE, async (client) => {
      const res = await client.query(`select ${PROFILE_COLUMNS} from app_user where id = $1`, [USER.ejerE]);
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("NEGATIV: en partner kan ikke læse en ejers telefonnummer", async () => {
    const rows = await asUserWithData(USER.partnerB, seedEjerE, async (client) => {
      const res = await client.query("select phone_e164 from app_user where phone_e164 is not null");
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("NEGATIV: en ejer ser kun sin egen række — også uden filter", async () => {
    const ids = await asUserWithData(USER.ejerA, seedEjerE, async (client) => {
      const res = await client.query("select id from app_user");
      return res.rows.map((r) => r.id);
    });
    expect(ids).toEqual([USER.ejerA]);
  });

  it("NEGATIV: brugeren kan ikke skrive til sin egen profil direkte (ingen write-policy — det går via serveren)", async () => {
    const outcome = await asUser(USER.ejerA, async (client) => {
      const res = await client.query("update app_user set display_name = 'Mig', time_zone = 'UTC' where id = $1", [
        USER.ejerA,
      ]);
      const after = await client.query("select display_name, time_zone from app_user where id = $1", [USER.ejerA]);
      return { updated: res.rowCount, after: after.rows[0] };
    });
    expect(outcome.updated).toBe(0);
    expect(outcome.after).toEqual({ display_name: null, time_zone: "Europe/Copenhagen" });
  });

  it("NEGATIV: brugeren kan ikke skrive til en andens profil", async () => {
    const updated = await asUserWithData(USER.ejerA, seedEjerE, async (client) => {
      const res = await client.query("update app_user set phone_e164 = '+4599999999' where id = $1", [USER.ejerE]);
      return res.rowCount;
    });
    expect(updated).toBe(0);
  });

  it("NEGATIV: heller ikke admin kan skrive til en profil direkte (admin har kun læse-policy)", async () => {
    const updated = await asUserWithData(USER.adminD, seedEjerE, async (client) => {
      const res = await client.query("update app_user set display_name = 'Ændret' where id = $1", [USER.ejerE]);
      return res.rowCount;
    });
    expect(updated).toBe(0);
  });

  it("NEGATIV: anonym ser ingen profiler", async () => {
    const rows = await asUser(null, async (client) => {
      const res = await client.query("select id from app_user");
      return res.rows;
    });
    expect(rows).toEqual([]);
  });
});

async function rejects(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await asPostgres(async (client) => {
      await client.query(sql, params);
    });
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? String(error);
  }
  return "ACCEPTERET";
}

async function accepts(sql: string, params: unknown[] = []): Promise<void> {
  await asPostgres(async (client) => {
    await client.query(sql, params);
  });
}

describe("kontoprofil — formatkontrol i databasen", () => {
  it("accepterer en komplet, gyldig profil", async () => {
    await accepts(
      `update app_user set display_name = $2, phone_e164 = '+4520000000', time_zone = 'America/Argentina/Buenos_Aires'
         where id = $1`,
      [USER.ejerA, "Eva Ejer"],
    );
    await accepts("update app_user set time_zone = 'UTC' where id = $1", [USER.ejerA]);
  });

  it.each([
    ["uden plus", "4520000000"],
    ["med mellemrum (normalisering er appens job)", "+45 20 00 00 00"],
    ["landekode 0", "+0123456789"],
    ["for kort", "+45123"],
    ["for langt", "+1234567890123456"],
    ["bogstaver", "+45abcdefgh"],
    ["tom streng", ""],
  ])("afviser telefonnummer %s", async (_label, value) => {
    expect(await rejects("update app_user set phone_e164 = $2 where id = $1", [USER.ejerA, value])).toBe(
      "app_user_phone_e164_format",
    );
  });

  it.each(["Copenhagen", "", "europe/copenhagen; drop table app_user", "+01:00", "Europe/", "Europe/Copenhagen/A/B"])(
    "afviser tidszone %j (forkert IANA-form)",
    async (value) => {
      expect(await rejects("update app_user set time_zone = $2 where id = $1", [USER.ejerA, value])).toBe(
        "app_user_time_zone_format",
      );
    },
  );

  it("tidszonen kan ikke være null", async () => {
    expect(await rejects("update app_user set time_zone = null where id = $1", [USER.ejerA])).toMatch(/time_zone/);
  });

  it.each([
    ["tomt navn", ""],
    ["kun mellemrum", "   "],
    ["over 100 tegn", "x".repeat(101)],
    ["styretegn (linjeskift)", "Eva\nEjer"],
  ])("afviser visningsnavn: %s", async (_label, value) => {
    expect(await rejects("update app_user set display_name = $2 where id = $1", [USER.ejerA, value])).toBe(
      "app_user_display_name_valid",
    );
  });

  it("accepterer et navn på præcis 100 tegn og danske bogstaver", async () => {
    await accepts("update app_user set display_name = $2 where id = $1", [USER.ejerA, "x".repeat(100)]);
    await accepts("update app_user set display_name = $2 where id = $1", [USER.ejerA, "Åse Ørsted-Æbelø"]);
  });
});

describe("kontoprofil — SMS-opt-in er fjernet (0027, ADR 0065)", () => {
  it("sms_opt_in, sms_opt_in_at og deres check-constraint findes ikke længere", async () => {
    const found = await asPostgres(async (client) => {
      const columns = await client.query(
        `select column_name from information_schema.columns
          where table_name = 'app_user' and column_name in ('sms_opt_in', 'sms_opt_in_at')`,
      );
      const constraints = await client.query(
        "select conname from pg_constraint where conname = 'app_user_sms_opt_in_consistent'",
      );
      return { columns: columns.rows, constraints: constraints.rows };
    });
    expect(found).toEqual({ columns: [], constraints: [] });
  });

  it("nummeret, navnet og tidszonen består — et nummer kan gemmes og fjernes uden noget samtykke ved siden af", async () => {
    await accepts("update app_user set phone_e164 = '+4520000000' where id = $1", [USER.ejerA]);
    await accepts("update app_user set phone_e164 = null where id = $1", [USER.ejerA]);
  });

  it("NEGATIV: de fjernede kolonner kan ikke længere skrives", async () => {
    expect(await rejects("update app_user set sms_opt_in = true where id = $1", [USER.ejerA])).toMatch(
      /sms_opt_in/,
    );
  });
});
