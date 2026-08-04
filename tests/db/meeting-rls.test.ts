import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * RLS for møde-datamodellen (0012, ADR 0026) + partner-login-policies (0011, ADR 0025).
 *
 * Seed: board b0a4d ejes af ejer-A; partner-B er koblet til katalogpost e0001 som sidder på
 * boardet (og er lead). Partner-C er BEVIDST ukoblet. To møder (f0001 planlagt, f0002 afholdt)
 * med e0001 som deltager; én note af e0001 på f0002.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  partnerC: "00000000-0000-0000-0000-00000000000c",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const MEETING = "00000000-0000-0000-0000-0000000f0001";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("meeting RLS (0012) — ejer, deltagende partner, admin", () => {
  it("ejer ser sit boards møder", async () => {
    expect(await countAs(USER.ejerA, "select id from meeting")).toBe(2);
  });

  it("koblet partner på boardet ser møderne", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting")).toBe(2);
  });

  it("admin ser alle møder", async () => {
    expect(await countAs(USER.adminD, "select id from meeting")).toBe(2);
  });

  it("NEGATIV: fremmed ejer ser ingen møder", async () => {
    expect(await countAs(USER.ejerE, "select id from meeting")).toBe(0);
  });

  it("NEGATIV: ukoblet partner ser ingen møder", async () => {
    expect(await countAs(USER.partnerC, "select id from meeting")).toBe(0);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null, "select id from meeting")).toBe(0);
  });

  it("NEGATIV: ingen kan skrive møder via RLS (writes kun via service-role)", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into meeting (board_id, starts_at)
             values ('00000000-0000-0000-0000-0000000b0a4d', '2026-10-01T10:00:00Z')`,
          ),
        ),
      ).rejects.toThrow();
    }
  });
});

describe("meeting_partner RLS (0012)", () => {
  it("ejer og deltagende partner ser deltagerrækkerne; admin ser alt", async () => {
    expect(await countAs(USER.ejerA, "select meeting_id from meeting_partner")).toBe(2);
    expect(await countAs(USER.partnerB, "select meeting_id from meeting_partner")).toBe(2);
    expect(await countAs(USER.adminD, "select meeting_id from meeting_partner")).toBe(2);
  });

  it("NEGATIV: fremmed ejer og ukoblet partner ser ingen deltagerrækker", async () => {
    expect(await countAs(USER.ejerE, "select meeting_id from meeting_partner")).toBe(0);
    expect(await countAs(USER.partnerC, "select meeting_id from meeting_partner")).toBe(0);
  });

  it("NEGATIV: en partner kan ikke selv skrive sin registrering via RLS (0 rækker ramt)", async () => {
    // Uden update-policy rammer UPDATE ingen rækker (RLS filtrerer; kaster ikke som insert).
    const updated = await countAs(
      USER.partnerB,
      `update meeting_partner set registered_status = 'afholdt'
       where meeting_id = '${MEETING}' returning meeting_id`,
    );
    expect(updated).toBe(0);
  });
});

describe("meeting_note RLS (0012) — restriktiv default (note-synlighed er ejer-uafklaret)", () => {
  it("forfatteren og boardets ejer ser noten; admin ser alt", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting_note")).toBe(1);
    expect(await countAs(USER.ejerA, "select id from meeting_note")).toBe(1);
    expect(await countAs(USER.adminD, "select id from meeting_note")).toBe(1);
  });

  it("NEGATIV: fremmed ejer og ukoblet partner ser ingen noter", async () => {
    expect(await countAs(USER.ejerE, "select id from meeting_note")).toBe(0);
    expect(await countAs(USER.partnerC, "select id from meeting_note")).toBe(0);
  });
});

describe("meeting_webhook_event (0012, ADR 0027) — idempotens + admin-only", () => {
  it("kun admin læser webhook-events", async () => {
    await asPostgres(async (client) => {
      await client.query(
        `insert into meeting_webhook_event (provider_event_id, event_type)
         values ('BOOKING_CREATED:uid-x:2026-08-04T10:00:00Z', 'BOOKING_CREATED')`,
      );
      // Samme transaktion: admin ser rækken, ejer/partner gør ikke. (asPostgres ruller tilbage.)
    });
    expect(await countAs(USER.ejerA, "select id from meeting_webhook_event")).toBe(0);
    expect(await countAs(USER.partnerB, "select id from meeting_webhook_event")).toBe(0);
  });

  it("IDEMPOTENS: samme provider-event kan ikke registreres to gange", async () => {
    await asPostgres(async (client) => {
      const insert = `insert into meeting_webhook_event (provider_event_id, event_type)
                      values ('BOOKING_CREATED:uid-1:2026-08-04T10:00:00Z', 'BOOKING_CREATED')`;
      await client.query(insert);
      await expect(client.query(insert)).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

describe("partner_profile partner-policies (0011, ADR 0025)", () => {
  it("koblet partner ser egen profil og tag-kobling", async () => {
    expect(
      await countAs(
        USER.partnerB,
        "select id from partner_profile where id = '00000000-0000-0000-0000-0000000e0001'",
      ),
    ).toBe(1);
    expect(
      await countAs(USER.partnerB, "select partner_profile_id from partner_profile_competence_tag"),
    ).toBe(1);
  });

  it("NEGATIV: partner ser ikke profiler uden for eget board (puljen forbliver skjult)", async () => {
    expect(
      await countAs(
        USER.partnerB,
        "select id from partner_profile where id != '00000000-0000-0000-0000-0000000e0001'",
      ),
    ).toBe(0);
  });

  it("NEGATIV: partner kan ikke redigere egne tags (write-policy findes ikke)", async () => {
    await expect(
      asUser(USER.partnerB, (client) =>
        client.query(
          `insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
             select '00000000-0000-0000-0000-0000000e0001', id from competence_tag
             where slug = 'oekonomi-og-noegletal'`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: partner kan ikke opdatere sin profil direkte via RLS (writes via service-role)", async () => {
    const updated = await countAs(
      USER.partnerB,
      `update partner_profile set title = 'Snydetitel'
       where id = '00000000-0000-0000-0000-0000000e0001' returning id`,
    );
    expect(updated).toBe(0);
  });
});
