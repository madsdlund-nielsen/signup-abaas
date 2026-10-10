import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * Notifikationsskabeloner + udsendelseslog (0021, ADR 0057).
 *
 * Tabellerne starter TOMME — ingen skabelontekst i migration eller seed (stub-politik). Alle
 * rækker her er åbenlyst syntetiske `[DEMO]`-tekster indsat i transaktioner der rulles tilbage.
 *
 * Kernekravene: kun admin læser; højst én live og ét udkast pr. (type, kanal); publicering
 * arkiverer den forrige live atomisk; en publiceret version er uforanderlig; idempotensnøglen
 * er unik; loggen indeholder en bruger-reference, aldrig en adresse.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
};

async function insertTemplate(
  client: Client,
  opts: { type?: string; channel?: "email" | "sms"; version?: number; status?: string } = {},
): Promise<string> {
  const { type = "meeting-reminder", channel = "email", version = 1, status = "udkast" } = opts;
  const subject = channel === "email" ? "'[DEMO] Emne'" : "null";
  const published = status === "udkast" ? "null" : "now()";
  const { rows } = await client.query(
    `insert into notification_template (type_key, channel, version, status, subject, body, published_at)
     values ($1, $2, $3, $4, ${subject}, '[DEMO] Brødtekst', ${published}) returning id`,
    [type, channel, version, status],
  );
  return (rows[0] as { id: string }).id;
}

describe("notification_template starter tom (ingen tekst i migration eller seed)", () => {
  it("der findes hverken skabeloner eller log-rækker efter migration + seed", async () => {
    await asPostgres(async (client) => {
      expect((await client.query("select 1 from notification_template")).rowCount).toBe(0);
      expect((await client.query("select 1 from notification_delivery")).rowCount).toBe(0);
    });
  });
});

describe("notification_template RLS (0021) — kun admin læser", () => {
  it("admin ser skabeloner; ejer, partner og null-session ser 0", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client);
      for (const [sub, expected] of [
        [USER.adminD, 1],
        [USER.ejerA, 0],
        [USER.partnerB, 0],
        ["", 0],
      ] as const) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const result = await client.query("select id from notification_template");
        expect(result.rowCount, `sub=${sub || "anon"}`).toBe(expected);
        await client.query("reset role");
      }
    });
  });

  it("NEGATIV: ingen kan skrive via RLS — heller ikke admin (writes kun via service-role)", async () => {
    for (const sub of [USER.adminD, USER.ejerA, USER.partnerB]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into notification_template (type_key, channel, version, subject, body)
             values ('meeting-reminder', 'email', 1, '[DEMO]', '[DEMO]')`,
          ),
        ),
        `sub=${sub}`,
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: authed kan ikke kalde publicerings-funktionen (revoked — kun service-role)", async () => {
    await expect(
      asUser(USER.adminD, (client) =>
        client.query("select publish_notification_template(gen_random_uuid(), null)"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("notification_template — invarianter", () => {
  it("INVARIANT: højst ÉN live pr. (type, kanal)", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client, { version: 1, status: "live" });
      await expect(insertTemplate(client, { version: 2, status: "live" })).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });
  });

  it("én live pr. kanal og pr. type er fint", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client, { channel: "email", version: 1, status: "live" });
      await insertTemplate(client, { channel: "sms", version: 1, status: "live" });
      await insertTemplate(client, { type: "rating-request", version: 1, status: "live" });
      expect((await client.query("select 1 from notification_template")).rowCount).toBe(3);
    });
  });

  it("INVARIANT: højst ÉT udkast pr. (type, kanal)", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client, { version: 1, status: "udkast" });
      await expect(insertTemplate(client, { version: 2, status: "udkast" })).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });
  });

  it("INVARIANT: versionsnummeret er unikt pr. (type, kanal)", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client, { version: 1, status: "arkiveret" });
      await expect(insertTemplate(client, { version: 1, status: "udkast" })).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });
  });

  it("e-mail kræver emne", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into notification_template (type_key, channel, version, subject, body)
           values ('meeting-reminder', 'email', 1, null, '[DEMO]')`,
        ),
      ).rejects.toThrow(/notification_template_subject_by_channel/);
    });
  });

  it("SMS har aldrig emne", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into notification_template (type_key, channel, version, subject, body)
           values ('meeting-reminder', 'sms', 1, '[DEMO] emne', '[DEMO]')`,
        ),
      ).rejects.toThrow(/notification_template_subject_by_channel/);
    });
  });

  it("brødteksten må ikke være tom", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into notification_template (type_key, channel, version, subject, body)
           values ('meeting-reminder', 'email', 1, '[DEMO]', '   ')`,
        ),
      ).rejects.toThrow(/check/i);
    });
  });

  it("et udkast er ikke publiceret; en live version er (published_at)", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into notification_template (type_key, channel, version, status, subject, body)
           values ('meeting-reminder', 'email', 1, 'live', '[DEMO]', '[DEMO]')`,
        ),
      ).rejects.toThrow(/notification_template_published_when_not_draft/);
    });
  });

  it("udkastet kan redigeres frit", async () => {
    await asPostgres(async (client) => {
      const id = await insertTemplate(client);
      await client.query("update notification_template set body = '[DEMO] Ny tekst' where id = $1", [id]);
      const { rows } = await client.query("select body from notification_template where id = $1", [id]);
      expect((rows[0] as { body: string }).body).toBe("[DEMO] Ny tekst");
    });
  });
});

describe("publish_notification_template (0021) — atomisk publicering, append-only historik", () => {
  it("udkastet bliver live og den forrige live bliver arkiveret — begge i samme kald", async () => {
    await asPostgres(async (client) => {
      const previous = await insertTemplate(client, { version: 1, status: "live" });
      const draft = await insertTemplate(client, { version: 2, status: "udkast" });
      await client.query("select publish_notification_template($1, $2)", [draft, USER.adminD]);

      const { rows } = await client.query(
        "select id, status, published_by from notification_template order by version",
      );
      expect(rows.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual([
        [previous, "arkiveret"],
        [draft, "live"],
      ]);
      expect((rows[1] as { published_by: string }).published_by).toBe(USER.adminD);
    });
  });

  it("første publicering (ingen tidligere live) virker og stempler published_at", async () => {
    await asPostgres(async (client) => {
      const draft = await insertTemplate(client, { version: 1, status: "udkast" });
      await client.query("select publish_notification_template($1, $2)", [draft, USER.adminD]);
      const { rows } = await client.query("select status, published_at from notification_template");
      expect(rows[0]).toMatchObject({ status: "live" });
      expect((rows[0] as { published_at: Date | null }).published_at).not.toBeNull();
    });
  });

  it("NEGATIV: kun et udkast kan publiceres", async () => {
    await asPostgres(async (client) => {
      const live = await insertTemplate(client, { version: 1, status: "live" });
      await expect(
        client.query("select publish_notification_template($1, $2)", [live, USER.adminD]),
      ).rejects.toThrow(/Kun et udkast/);
    });
  });

  it("NEGATIV: et ukendt id afvises", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query("select publish_notification_template(gen_random_uuid(), $1)", [USER.adminD]),
      ).rejects.toThrow(/findes ikke/);
    });
  });

  it("andre (type, kanal)-par er upåvirkede af en publicering", async () => {
    await asPostgres(async (client) => {
      await insertTemplate(client, { channel: "sms", version: 1, status: "live" });
      const draft = await insertTemplate(client, { channel: "email", version: 1, status: "udkast" });
      await client.query("select publish_notification_template($1, $2)", [draft, USER.adminD]);
      const { rows } = await client.query(
        "select channel, status from notification_template order by channel",
      );
      expect(rows).toEqual([
        { channel: "email", status: "live" },
        { channel: "sms", status: "live" },
      ]);
    });
  });
});

describe("notification_template — publicerede versioner er uforanderlige (trigger)", () => {
  it("NEGATIV: indholdet af en live version kan ikke ændres", async () => {
    await asPostgres(async (client) => {
      const id = await insertTemplate(client, { status: "live" });
      await expect(
        client.query("update notification_template set body = '[DEMO] Ændret' where id = $1", [id]),
      ).rejects.toThrow(/uforanderlig/);
    });
    await asPostgres(async (client) => {
      const id = await insertTemplate(client, { status: "live" });
      await expect(
        client.query("update notification_template set subject = '[DEMO] Ændret' where id = $1", [id]),
      ).rejects.toThrow(/uforanderlig/);
    });
  });

  it("NEGATIV: en arkiveret version er låst og kan ikke genoplives", async () => {
    await asPostgres(async (client) => {
      const id = await insertTemplate(client, { status: "arkiveret" });
      await expect(
        client.query("update notification_template set body = '[DEMO] Ændret' where id = $1", [id]),
      ).rejects.toThrow(/uforanderlig/);
    });
    await asPostgres(async (client) => {
      const id = await insertTemplate(client, { status: "arkiveret" });
      await expect(
        client.query("update notification_template set status = 'live' where id = $1", [id]),
      ).rejects.toThrow(/Ugyldigt statusskift/);
    });
  });

  it("NEGATIV: identitet (type, kanal, version) kan aldrig ændres", async () => {
    await asPostgres(async (client) => {
      const id = await insertTemplate(client);
      await expect(
        client.query("update notification_template set version = 9 where id = $1", [id]),
      ).rejects.toThrow(/identitet/);
    });
    await asPostgres(async (client) => {
      const id = await insertTemplate(client);
      await expect(
        client.query("update notification_template set type_key = 'rating-request' where id = $1", [id]),
      ).rejects.toThrow(/identitet/);
    });
  });

  it("NEGATIV: indhold kan ikke ændres i samme skridt som et udkast gøres live", async () => {
    await asPostgres(async (client) => {
      const id = await insertTemplate(client);
      await expect(
        client.query(
          `update notification_template set status = 'live', published_at = now(), body = '[DEMO] Smuglet'
           where id = $1`,
          [id],
        ),
      ).rejects.toThrow(/Indholdet må ikke ændres/);
    });
  });

  it("kun udkast kan slettes — publicerede versioner er historik", async () => {
    await asPostgres(async (client) => {
      const draft = await insertTemplate(client, { version: 2, status: "udkast" });
      const live = await insertTemplate(client, { version: 1, status: "live" });
      await client.query("delete from notification_template where id = $1", [draft]);
      await expect(
        client.query("delete from notification_template where id = $1", [live]),
      ).rejects.toThrow(/kan ikke slettes/);
    });
  });

  it("sletning af den publicerende admin-konto nulstiller published_by uden at bryde historikken", async () => {
    await asPostgres(async (client) => {
      await client.query(
        "insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'midlertidig-admin@example.com')",
      );
      const draft = await insertTemplate(client, { version: 1, status: "udkast" });
      await client.query("select publish_notification_template($1, $2)", [
        draft,
        "00000000-0000-0000-0000-0000000000f1",
      ]);
      await client.query("delete from app_user where id = '00000000-0000-0000-0000-0000000000f1'");
      const { rows } = await client.query(
        "select status, published_by from notification_template where id = $1",
        [draft],
      );
      expect(rows[0]).toEqual({ status: "live", published_by: null });
    });
  });
});

describe("notification_delivery (0021) — log uden persondata, idempotent, kun admin læser", () => {
  async function insertDelivery(client: Client, key: string, status = "sendt"): Promise<void> {
    await client.query(
      `insert into notification_delivery
         (type_key, channel, recipient_user_id, related_id, status, attempt, idempotency_key)
       values ('meeting-changed', 'email', $1, gen_random_uuid(), $2, 1, $3)`,
      [USER.partnerB, status, key],
    );
  }

  it("IDEMPOTENS: samme nøgle kan ikke logges (og dermed ikke sendes) to gange", async () => {
    await asPostgres(async (client) => {
      await insertDelivery(client, "meeting-changed:m1:u1:email");
      await expect(insertDelivery(client, "meeting-changed:m1:u1:email")).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });
  });

  it("en anden kanal giver en anden nøgle og er dermed tilladt", async () => {
    await asPostgres(async (client) => {
      await insertDelivery(client, "meeting-changed:m1:u1:email");
      await insertDelivery(client, "meeting-changed:m1:u1:sms");
      expect((await client.query("select 1 from notification_delivery")).rowCount).toBe(2);
    });
  });

  it("alle fem statusser er lovlige", async () => {
    await asPostgres(async (client) => {
      for (const status of ["afventer", "sendt", "fejlet", "stub", "demo"]) {
        await insertDelivery(client, `k-${status}`, status);
      }
      expect((await client.query("select 1 from notification_delivery")).rowCount).toBe(5);
    });
  });

  it("NEGATIV: en ukendt status afvises", async () => {
    await asPostgres(async (client) => {
      await expect(insertDelivery(client, "k-ukendt", "halvt")).rejects.toThrow(/invalid input value/);
    });
  });

  it("loggen har ingen kolonne til e-mailadresse eller telefonnummer", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `select column_name from information_schema.columns
          where table_name = 'notification_delivery'`,
      );
      const columns = rows.map((r: { column_name: string }) => r.column_name);
      expect(columns).toContain("recipient_user_id");
      for (const forbidden of ["email", "to", "phone", "telefon", "address", "recipient"]) {
        expect(columns, `kolonne '${forbidden}' må ikke findes`).not.toContain(forbidden);
      }
    });
  });

  it("admin ser loggen; ejer, partner og null-session ser 0", async () => {
    await asPostgres(async (client) => {
      await insertDelivery(client, "k-rls");
      for (const [sub, expected] of [
        [USER.adminD, 1],
        [USER.ejerA, 0],
        [USER.partnerB, 0],
        ["", 0],
      ] as const) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const result = await client.query("select id from notification_delivery");
        expect(result.rowCount, `sub=${sub || "anon"}`).toBe(expected);
        await client.query("reset role");
      }
    });
  });

  it("NEGATIV: ingen kan skrive loggen via RLS — heller ikke modtageren selv", async () => {
    for (const sub of [USER.adminD, USER.partnerB]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into notification_delivery (type_key, channel, recipient_user_id, idempotency_key)
             values ('meeting-changed', 'email', '${USER.partnerB}', 'k-rls-write')`,
          ),
        ),
        `sub=${sub}`,
      ).rejects.toThrow();
    }
  });

  it("rækken følger brugeren ved sletning (cascade) — ingen forældreløs log", async () => {
    await asPostgres(async (client) => {
      await insertDelivery(client, "k-cascade");
      await client.query("delete from app_user where id = $1", [USER.partnerB]);
      expect((await client.query("select 1 from notification_delivery")).rowCount).toBe(0);
    });
  });
});
