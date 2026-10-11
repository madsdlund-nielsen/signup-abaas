import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { asPostgres, asUser } from "./helpers";

/**
 * GDPR-sletning (0028, ADR 0068): `erasure_receipt` (kun admin læser, ingen skriver via RLS) og
 * `erase_data_subject` (én transaktion, fail-closed på opbevaringspligt, boardets invarianter via
 * `change_board_composition`, kun service-role). Alt sker som DB-ejer (≈ service-role) i
 * transaktioner der rulles tilbage.
 *
 * Seed: ejer-A ejer A's board, som HAR et medlemskab (0013) → A kan ikke slettes (opbevaringspligt).
 * Partner Én (intern, lead) sidder på A's board og er koblet til partner-B. Andre brugere oprettes her.
 */
const ADMIN = "00000000-0000-0000-0000-00000000000d";
const EJER_A = "00000000-0000-0000-0000-00000000000a";
const PARTNER_B = "00000000-0000-0000-0000-00000000000b";
const BOARD_A = "00000000-0000-0000-0000-0000000b0a4d";
const P1 = "00000000-0000-0000-0000-0000000e0001"; // intern, lead på A's board
const P2 = "00000000-0000-0000-0000-0000000e0002"; // ekstern
const P3 = "00000000-0000-0000-0000-0000000e0003"; // intern
const OPTION = "00000000-0000-0000-0000-0000000c0a01";

// Genererede id'er til rækker vi selv opretter (faste, så testen er deterministisk).
const X = "00000000-0000-0000-0000-0000000000f1"; // ejer uden betalingsdata
const Y = "00000000-0000-0000-0000-0000000000f2"; // partner-login
const Z = "00000000-0000-0000-0000-0000000000f3"; // anden ejer
const BOARD_X = "00000000-0000-0000-0000-00000b0a4d01";
const BOARD_Z = "00000000-0000-0000-0000-00000b0a4d02";
const PROFILE_Y = "00000000-0000-0000-0000-0000000e00f2";
const MEETING_X = "00000000-0000-0000-0000-0000000f00f1";
const MEETING_Z = "00000000-0000-0000-0000-0000000f00f2";

async function addUser(client: Client, id: string, email: string, role: string, name: string | null = null): Promise<void> {
  await client.query("insert into app_user (id, email, display_name, phone_e164) values ($1, $2, $3, $4)", [
    id,
    email,
    name,
    name ? "+4500000001" : null,
  ]);
  await client.query("insert into user_role_assignment (user_id, role) values ($1, $2)", [id, role]);
}

/** Ejer X: board med to partnere, et møde med noter/dagsorden/resumé, kvizsvar, vurdering, besked, link, spor. */
async function seedOwnerX(client: Client): Promise<void> {
  await addUser(client, X, "ejer-x@example.com", "ejer", "[DEMO] Ejer X");
  await client.query("insert into board (id, owner_id, name) values ($1, $2, 'X''s board')", [BOARD_X, X]);
  await client.query("insert into board_partner (board_id, partner_id, is_lead) values ($1, $2, true), ($1, $3, false)", [
    BOARD_X,
    P1,
    P2,
  ]);
  await client.query("insert into meeting (id, board_id, starts_at, status) values ($1, $2, '2026-09-01T10:00:00Z', 'planlagt')", [
    MEETING_X,
    BOARD_X,
  ]);
  await client.query("insert into meeting_partner (meeting_id, partner_profile_id) values ($1, $2)", [MEETING_X, P1]);
  await client.query("insert into meeting_note (meeting_id, partner_profile_id, body) values ($1, $2, 'Note')", [MEETING_X, P1]);
  await client.query("insert into meeting_agenda_item (meeting_id, kind, body) values ($1, 'dagsorden', 'Punkt')", [MEETING_X]);
  await client.query("insert into meeting_summary (meeting_id) values ($1)", [MEETING_X]);
  await client.query("insert into quiz_answer (owner_id, quiz_option_id) values ($1, $2)", [X, OPTION]);
  await client.query("insert into meeting_rating (meeting_id, rater_user_id, score) values ($1, $2, 5)", [MEETING_X, X]);
  await client.query(
    "insert into notification_delivery (type_key, channel, recipient_user_id, idempotency_key) values ('test', 'email', $1, 'x-1')",
    [X],
  );
  await client.query(
    "insert into rating_link (meeting_id, rater_user_id, expires_at) values ($1, $2, '2030-01-01T00:00:00Z')",
    [MEETING_X, X],
  );
  // Revisionsspor hvor X er aktør — på A's board, som ikke slettes.
  await client.query(
    `insert into board_change (board_id, actor_id, actor_role, action, partner_id, calcom_sync)
     values ($1, $2, 'ejer', 'tilfoej', $3, 'opdateret')`,
    [BOARD_A, X, P3],
  );
}

/** Partner Y: egen katalogpost med login, tags, tilgængelighed, fravær, noter og vurderinger. */
async function seedPartnerY(client: Client): Promise<void> {
  await addUser(client, Y, "partner-y@example.com", "partner", "[DEMO] Partner Y");
  await client.query(
    "insert into partner_profile (id, name, is_internal, app_user_id, sort_order) values ($1, '[DEMO] Partner Y', false, $2, 9)",
    [PROFILE_Y, Y],
  );
  await client.query(
    "insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id) select $1, id from competence_tag limit 1",
    [PROFILE_Y],
  );
  await client.query(
    "insert into partner_availability (partner_profile_id, weekday, start_time, end_time) values ($1, 1, '09:00', '12:00')",
    [PROFILE_Y],
  );
  await client.query(
    "insert into partner_absence (partner_profile_id, starts_on, ends_on, note) values ($1, '2026-12-01', '2026-12-05', 'Privat')",
    [PROFILE_Y],
  );
  // Z's board [P1 (intern, lead), P3 (intern), Y] med et møde Y deltager i, med note og vurdering.
  await addUser(client, Z, "ejer-z@example.com", "ejer");
  await client.query("insert into board (id, owner_id, name) values ($1, $2, 'Z''s board')", [BOARD_Z, Z]);
  await client.query(
    "insert into board_partner (board_id, partner_id, is_lead) values ($1, $2, true), ($1, $3, false), ($1, $4, false)",
    [BOARD_Z, P1, P3, PROFILE_Y],
  );
  await client.query("insert into meeting (id, board_id, starts_at, status) values ($1, $2, '2026-09-02T10:00:00Z', 'planlagt')", [
    MEETING_Z,
    BOARD_Z,
  ]);
  await client.query("insert into meeting_partner (meeting_id, partner_profile_id) values ($1, $2), ($1, $3)", [
    MEETING_Z,
    P1,
    PROFILE_Y,
  ]);
  await client.query("insert into meeting_note (meeting_id, partner_profile_id, body) values ($1, $2, 'Ys note')", [MEETING_Z, PROFILE_Y]);
  await client.query("insert into meeting_prep_note (meeting_id, partner_profile_id, body) values ($1, $2, 'Ys forberedelse')", [
    MEETING_Z,
    PROFILE_Y,
  ]);
  await client.query(
    "insert into meeting_rating (meeting_id, rater_partner_profile_id, score) values ($1, $2, 4)",
    [MEETING_Z, PROFILE_Y],
  );
  await client.query(
    "insert into meeting_rating (meeting_id, rater_user_id, subject_partner_profile_id, score) values ($1, $2, $3, 3)",
    [MEETING_Z, Z, PROFILE_Y],
  );
}

const ERASE = "select erase_data_subject($1, $2, $3::jsonb) as result";

function removal(boardId: string, expected: string[], partnerId: string, lead: string | null) {
  return { board_id: boardId, expected_partner_ids: expected, partner_id: partnerId, lead_id: lead };
}

async function erase(client: Client, user: string, actor: string, removals: unknown[] = []) {
  const { rows } = await client.query(ERASE, [user, actor, JSON.stringify(removals)]);
  return rows[0].result as { deleted: Record<string, number>; board_changes: Array<{ board_id: string; change_id: string }> };
}

/** Kald der forventes afvist (savepoint, så transaktionen overlever). */
async function rejected(client: Client, user: string, actor: string, removals: unknown[] = []): Promise<string> {
  await client.query("savepoint attempt");
  try {
    await erase(client, user, actor, removals);
  } catch (e) {
    await client.query("rollback to savepoint attempt");
    return (e as Error).message;
  }
  throw new Error("Funktionen burde have afvist kaldet");
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await client.query(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);
}

describe("erasure_receipt — RLS (0028)", () => {
  async function insertReceipt(client: Client): Promise<void> {
    await client.query(
      `insert into erasure_receipt (subject_hash, requested_by, outcome, systems, missing)
       values (repeat('a', 64), $1, 'gennemfoert', '[{"system":"supabase","status":"slettet","detail":"x"}]'::jsonb, '{}')`,
      [ADMIN],
    );
  }

  it("starter tom", async () => {
    await asPostgres(async (client) => {
      expect(await count(client, "select 1 from erasure_receipt")).toBe(0);
    });
  });

  it("admin læser; ejer, partner og anonym ser 0", async () => {
    await asPostgres(async (client) => {
      await insertReceipt(client);
      for (const [sub, expected] of [
        [ADMIN, 1],
        [EJER_A, 0],
        [PARTNER_B, 0],
        ["", 0],
      ] as const) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const result = await client.query("select id from erasure_receipt");
        expect(result.rowCount, `sub=${sub || "anon"}`).toBe(expected);
        await client.query("reset role");
      }
    });
  });

  it("NEGATIV: ingen skriver via RLS — heller ikke admin", async () => {
    for (const sub of [ADMIN, EJER_A]) {
      await expect(
        asUser(sub, async (client) => {
          await client.query(
            "insert into erasure_receipt (subject_hash, outcome, systems) values (repeat('a', 64), 'gennemfoert', '[]'::jsonb)",
          );
        }),
        `sub=${sub}`,
      ).rejects.toThrow(/row-level security/);
    }
    await asUser(ADMIN, async (client) => {
      await asPostgres(async (owner) => insertReceipt(owner));
      const updated = await client.query("update erasure_receipt set outcome = 'delvist'");
      const deleted = await client.query("delete from erasure_receipt");
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
    });
  });

  it("check-constraints: id-hash skal være SHA-256 hex, udfald og systemer har en fast form", async () => {
    await asPostgres(async (client) => {
      for (const [hash, outcome, systems] of [
        ["ikke-et-hash", "gennemfoert", "[]"],
        ["a".repeat(64), "ukendt", "[]"],
        ["a".repeat(64), "gennemfoert", "{}"],
      ]) {
        await client.query("savepoint s");
        await expect(
          client.query("insert into erasure_receipt (subject_hash, outcome, systems) values ($1, $2, $3::jsonb)", [
            hash,
            outcome,
            systems,
          ]),
        ).rejects.toThrow(/check constraint/);
        await client.query("rollback to savepoint s");
      }
    });
  });

  it("kvitteringen overlever at admin-kontoen slettes (requested_by sættes til null)", async () => {
    await asPostgres(async (client) => {
      await addUser(client, X, "admin-2@example.com", "admin");
      await client.query(
        "insert into erasure_receipt (subject_hash, requested_by, outcome, systems) values (repeat('b', 64), $1, 'delvist', '[]'::jsonb)",
        [X],
      );
      await client.query("delete from app_user where id = $1", [X]);
      const { rows } = await client.query("select requested_by from erasure_receipt");
      expect(rows).toEqual([{ requested_by: null }]);
    });
  });
});

describe("erase_data_subject — kun service-role", () => {
  it("NEGATIV: hverken app-rollen eller PUBLIC kan eksekvere funktionen, og den er security invoker", async () => {
    const sig = "public.erase_data_subject(uuid, uuid, jsonb)";
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `select has_function_privilege('app_authenticated', $1, 'EXECUTE') as authed,
                has_function_privilege('public', $1, 'EXECUTE') as pub,
                (select prosecdef from pg_proc where oid = $1::regprocedure) as definer`,
        [sig],
      );
      expect(rows[0]).toEqual({ authed: false, pub: false, definer: false });
    });
  });

  it("NEGATIV: hverken admin, ejer eller anonym kan kalde den via klientrollen (rpc)", async () => {
    for (const sub of [ADMIN, EJER_A, null]) {
      await expect(
        asUser(sub, (client) => client.query(ERASE, [X, ADMIN, "[]"])),
        `sub=${sub}`,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("erase_data_subject — fail-closed på opbevaringspligt (🔴 ejer/jura)", () => {
  it("NEGATIV: ejer-A har et medlemskab på sit board → afvist, og intet er rørt", async () => {
    await asPostgres(async (client) => {
      const before = await count(client, "select 1 from board where owner_id = $1", [EJER_A]);
      const message = await rejected(client, EJER_A, ADMIN);
      expect(message).toMatch(/opbevaringspligt: personen har betalingsdata/);
      expect(await count(client, "select 1 from board where owner_id = $1", [EJER_A])).toBe(before);
      expect(await count(client, "select 1 from membership")).toBe(1);
      expect(await count(client, "select 1 from user_role_assignment where user_id = $1", [EJER_A])).toBe(1);
    });
  });

  it("NEGATIV: en ejer hvis møde bærer et registreret honorargrundlag kan ikke slettes", async () => {
    await asPostgres(async (client) => {
      await seedOwnerX(client);
      await client.query("update meeting_partner set registered_status = 'afholdt' where meeting_id = $1", [MEETING_X]);
      expect(await rejected(client, X, ADMIN)).toMatch(/opbevaringspligt: personen indgår i et registreret honorargrundlag/);
      expect(await count(client, "select 1 from board where owner_id = $1", [X])).toBe(1);
    });
  });

  it("NEGATIV: en partner med registreret honorargrundlag kan ikke slettes", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      await client.query(
        "update meeting_partner set registered_status = 'forsinket_afbud' where partner_profile_id = $1",
        [PROFILE_Y],
      );
      const plan = [removal(BOARD_Z, [P1, P3, PROFILE_Y], PROFILE_Y, P1)];
      expect(await rejected(client, Y, ADMIN, plan)).toMatch(/opbevaringspligt/);
      expect(await count(client, "select 1 from partner_profile where id = $1", [PROFILE_Y])).toBe(1);
    });
  });
});

describe("erase_data_subject — driftsværn", () => {
  it("NEGATIV: en admin kan ikke slette sig selv, og den sidste admin kan ikke slettes", async () => {
    await asPostgres(async (client) => {
      expect(await rejected(client, ADMIN, ADMIN)).toMatch(/sig selv/);
      expect(await rejected(client, ADMIN, EJER_A)).toMatch(/sidste admin/);
      expect(await count(client, "select 1 from user_role_assignment where user_id = $1", [ADMIN])).toBe(1);
    });
  });

  it("en admin KAN slettes når en anden admin findes", async () => {
    await asPostgres(async (client) => {
      await addUser(client, X, "admin-2@example.com", "admin");
      await erase(client, ADMIN, X);
      expect(await count(client, "select 1 from user_role_assignment where user_id = $1", [ADMIN])).toBe(0);
    });
  });

  it("NEGATIV: en ukendt person afvises", async () => {
    await asPostgres(async (client) => {
      expect(await rejected(client, X, ADMIN)).toMatch(/findes ikke/);
    });
  });
});

describe("erase_data_subject — ejer", () => {
  it("sletter personens data og rører ikke andres", async () => {
    await asPostgres(async (client) => {
      await seedOwnerX(client);
      const aBefore = {
        boards: await count(client, "select 1 from board where owner_id = $1", [EJER_A]),
        meetings: await count(client, "select 1 from meeting where board_id = $1", [BOARD_A]),
        quiz: await count(client, "select 1 from quiz_answer where owner_id = $1", [EJER_A]),
        ratings: await count(client, "select 1 from meeting_rating where rater_user_id = $1", [EJER_A]),
        notes: await count(client, "select 1 from meeting_note"),
        profiles: await count(client, "select 1 from partner_profile"),
        roles: await count(client, "select 1 from user_role_assignment where user_id <> $1", [X]),
      };

      const { deleted, board_changes } = await erase(client, X, ADMIN);
      expect(board_changes).toEqual([]);
      expect(deleted).toMatchObject({ board: 1, quiz_answer: 1, notification_delivery: 1, user_role_assignment: 1, board_change_actor: 1 });

      // Det der hang på X er væk — også via cascade fra boardet.
      for (const [label, sql] of [
        ["board", "select 1 from board where owner_id = $1"],
        ["møde", "select 1 from meeting where board_id = $2 and $1::uuid is not null"],
        ["board_partner", "select 1 from board_partner where board_id = $2 and $1::uuid is not null"],
        ["note", "select 1 from meeting_note where meeting_id in (select id from meeting where board_id = $2) and $1::uuid is not null"],
        ["dagsorden", "select 1 from meeting_agenda_item where meeting_id in (select id from meeting where board_id = $2) and $1::uuid is not null"],
        ["resumé", "select 1 from meeting_summary where meeting_id in (select id from meeting where board_id = $2) and $1::uuid is not null"],
        ["kvizsvar", "select 1 from quiz_answer where owner_id = $1"],
        ["vurdering", "select 1 from meeting_rating where rater_user_id = $1"],
        ["besked", "select 1 from notification_delivery where recipient_user_id = $1"],
        ["link", "select 1 from rating_link where rater_user_id = $1"],
        ["rolle", "select 1 from user_role_assignment where user_id = $1"],
      ] as const) {
        expect(await count(client, sql.replace(/\$2/g, `'${BOARD_X}'::uuid`), [X]), label).toBe(0);
      }

      // Andres rækker er urørt.
      expect({
        boards: await count(client, "select 1 from board where owner_id = $1", [EJER_A]),
        meetings: await count(client, "select 1 from meeting where board_id = $1", [BOARD_A]),
        quiz: await count(client, "select 1 from quiz_answer where owner_id = $1", [EJER_A]),
        ratings: await count(client, "select 1 from meeting_rating where rater_user_id = $1", [EJER_A]),
        notes: await count(client, "select 1 from meeting_note"),
        profiles: await count(client, "select 1 from partner_profile"),
        roles: await count(client, "select 1 from user_role_assignment where user_id <> $1", [X]),
      }).toEqual({ ...aBefore, notes: aBefore.notes - 1 }); // Xs møde havde én note (Partner Éns)

      // Sporet består som anonym historik: aktøren er nulstillet.
      const trail = await client.query("select actor_id, actor_role from board_change where board_id = $1", [BOARD_A]);
      expect(trail.rows).toEqual([{ actor_id: null, actor_role: "ejer" }]);

      // Kontoankeret består, blankeret (e-mail beholdes til Auth-sletningen / en genkørsel).
      const anchor = await client.query("select email, display_name, phone_e164 from app_user where id = $1", [X]);
      expect(anchor.rows).toEqual([{ email: "ejer-x@example.com", display_name: null, phone_e164: null }]);
    });
  });

  it("idempotent: en genkørsel mod det blankerede anker sletter intet og fejler ikke", async () => {
    await asPostgres(async (client) => {
      await seedOwnerX(client);
      await erase(client, X, ADMIN);
      const second = await erase(client, X, ADMIN);
      expect(Object.values(second.deleted).every((n) => n === 0)).toBe(true);
      expect(second.board_changes).toEqual([]);
    });
  });

  it("når Auth-brugeren slettes fjerner 0004-triggeren ankeret", async () => {
    await asPostgres(async (client) => {
      await seedOwnerX(client);
      await client.query("insert into auth.users (id) values ($1)", [X]);
      await erase(client, X, ADMIN);
      await client.query("delete from auth.users where id = $1", [X]);
      expect(await count(client, "select 1 from app_user where id = $1", [X])).toBe(0);
    });
  });
});

describe("erase_data_subject — partner (B-68)", () => {
  it("fjerner partneren fra boardet via sammensætningen (spor + invarianter) og sletter profilen med alt der hænger på", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      const { deleted, board_changes } = await erase(client, Y, ADMIN, [removal(BOARD_Z, [P1, P3, PROFILE_Y], PROFILE_Y, P1)]);
      expect(deleted).toMatchObject({ partner_profile: 1 });
      expect(board_changes).toHaveLength(1);

      // Boardet består med to partnere og samme lead; revisionsrækken står (med den pessimistiske sync).
      const members = await client.query("select partner_id, is_lead from board_partner where board_id = $1 order by partner_id", [BOARD_Z]);
      expect(members.rows).toEqual([
        { partner_id: P1, is_lead: true },
        { partner_id: P3, is_lead: false },
      ]);
      const trail = await client.query("select actor_id, actor_role, action, partner_id, calcom_sync from board_change where id = $1", [
        board_changes[0]?.change_id,
      ]);
      // partner_id er nulstillet, fordi katalogposten er slettet; udføreren er admin, ikke den slettede.
      expect(trail.rows).toEqual([{ actor_id: ADMIN, actor_role: "admin", action: "fjern", partner_id: null, calcom_sync: "fejlet" }]);

      // Alt der hang på profilen er væk.
      for (const sql of [
        "select 1 from partner_profile where id = $1",
        "select 1 from partner_profile_competence_tag where partner_profile_id = $1",
        "select 1 from partner_availability where partner_profile_id = $1",
        "select 1 from partner_absence where partner_profile_id = $1",
        "select 1 from meeting_note where partner_profile_id = $1",
        "select 1 from meeting_prep_note where partner_profile_id = $1",
        "select 1 from meeting_partner where partner_profile_id = $1",
        "select 1 from meeting_rating where rater_partner_profile_id = $1 or subject_partner_profile_id = $1",
      ]) {
        expect(await count(client, sql, [PROFILE_Y]), sql).toBe(0);
      }

      // Andres rækker er urørt: Z's møde og de to andre partnere findes stadig.
      expect(await count(client, "select 1 from meeting where id = $1", [MEETING_Z])).toBe(1);
      expect(await count(client, "select 1 from partner_profile where id in ($1, $2)", [P1, P3])).toBe(2);
      expect(await count(client, "select 1 from meeting_partner where meeting_id = $1 and partner_profile_id = $2", [MEETING_Z, P1])).toBe(1);
      expect(await count(client, "select 1 from app_user where id = $1", [Z])).toBe(1);
    });
  });

  it("lead-partneren selv kan fjernes når planen flytter leadet til en anden intern", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      // Y bliver intern lead på Z's board; P1 afgiver leadet.
      await client.query("update partner_profile set is_internal = true where id = $1", [PROFILE_Y]);
      await client.query("update board_partner set is_lead = (partner_id = $2) where board_id = $1", [BOARD_Z, PROFILE_Y]);
      await erase(client, Y, ADMIN, [removal(BOARD_Z, [P1, P3, PROFILE_Y], PROFILE_Y, P1)]);
      const leads = await client.query("select partner_id from board_partner where board_id = $1 and is_lead", [BOARD_Z]);
      expect(leads.rows).toEqual([{ partner_id: P1 }]);
    });
  });

  it("NEGATIV (B-68): et board under to partnere afvises — hele sletningen ruller tilbage", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      await client.query("delete from board_partner where board_id = $1 and partner_id = $2", [BOARD_Z, P3]);
      const message = await rejected(client, Y, ADMIN, [removal(BOARD_Z, [P1, PROFILE_Y], PROFILE_Y, P1)]);
      expect(message).toMatch(/2-3 partnere/);
      expect(await count(client, "select 1 from partner_profile where id = $1", [PROFILE_Y])).toBe(1);
      expect(await count(client, "select 1 from board_partner where board_id = $1", [BOARD_Z])).toBe(2);
      expect(await count(client, "select 1 from user_role_assignment where user_id = $1", [Y])).toBe(1);
    });
  });

  it("NEGATIV (B-68): fjernes den sidste interne, afvises sletningen", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      // Boardet: P2 (ekstern), Y (intern, lead) og P4 (ekstern) — Y er den eneste interne.
      await client.query("update partner_profile set is_internal = true where id = $1", [PROFILE_Y]);
      await client.query("delete from board_partner where board_id = $1", [BOARD_Z]);
      await client.query(
        "insert into board_partner (board_id, partner_id, is_lead) values ($1, $2, false), ($1, $3, true), ($1, $4, false)",
        [BOARD_Z, P2, PROFILE_Y, "00000000-0000-0000-0000-0000000e0004"],
      );
      const message = await rejected(client, Y, ADMIN, [
        removal(BOARD_Z, [P2, PROFILE_Y, "00000000-0000-0000-0000-0000000e0004"], PROFILE_Y, null),
      ]);
      expect(message).toMatch(/mindst én intern|præcis én lead/);
      expect(await count(client, "select 1 from partner_profile where id = $1", [PROFILE_Y])).toBe(1);
    });
  });

  it("NEGATIV: uden en plan for boardet nægter funktionen at slette katalogposten (cascade må ikke tage partneren stille)", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      const message = await rejected(client, Y, ADMIN, []);
      expect(message).toMatch(/sidder stadig på et board/);
      expect(await count(client, "select 1 from board_partner where board_id = $1", [BOARD_Z])).toBe(3);
    });
  });

  it("NEGATIV: en forældet plan (boardet er ændret imens) afvises med 40001", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      await client.query("savepoint attempt");
      await expect(erase(client, Y, ADMIN, [removal(BOARD_Z, [P1, PROFILE_Y], PROFILE_Y, P1)])).rejects.toMatchObject({ code: "40001" });
      await client.query("rollback to savepoint attempt");
    });
  });

  it("NEGATIV: planen må kun handle om personens egen katalogpost", async () => {
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      const message = await rejected(client, Y, ADMIN, [removal(BOARD_Z, [P1, P3, PROFILE_Y], P3, P1)]);
      expect(message).toMatch(/anden partner end personens egen/);
      expect(await count(client, "select 1 from board_partner where board_id = $1", [BOARD_Z])).toBe(3);
    });
  });
});

describe("erase_data_subject — skemaet er registreret (ADR 0053's opfølgning)", () => {
  /**
   * Hver fremmednøgle der peger på `app_user` eller `partner_profile` er en sti til persondata. Funktionen
   * dækker dem alle (eksplicit eller via cascade). Kommer der en ny, skal funktionen (og denne liste)
   * udvides bevidst — ellers ville sletningen stille efterlade rækker.
   */
  async function referrers(client: Client, table: string): Promise<string[]> {
    const { rows } = await client.query(
      `select c.conrelid::regclass::text || '.' || a.attname as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.confrelid = $1::regclass
        order by 1`,
      [table],
    );
    return rows.map((r) => r.ref as string);
  }

  it("fremmednøgler til app_user", async () => {
    await asPostgres(async (client) => {
      expect(await referrers(client, "app_user")).toEqual([
        "board.owner_id",
        "board_change.actor_id",
        "erasure_receipt.requested_by",
        "meeting_rating.rater_user_id",
        "notification_delivery.recipient_user_id",
        "notification_template.published_by",
        "partner_profile.app_user_id",
        "quiz_answer.owner_id",
        "rating_link.rater_user_id",
        "user_role_assignment.user_id",
      ]);
    });
  });

  it("fremmednøgler til partner_profile", async () => {
    await asPostgres(async (client) => {
      expect(await referrers(client, "partner_profile")).toEqual([
        "board_change.partner_id",
        "board_change.replaced_partner_id",
        "board_partner.partner_id",
        "meeting_note.partner_profile_id",
        "meeting_partner.partner_profile_id",
        "meeting_prep_note.partner_profile_id",
        "meeting_rating.rater_partner_profile_id",
        "meeting_rating.subject_partner_profile_id",
        "partner_absence.partner_profile_id",
        "partner_availability.partner_profile_id",
        "partner_profile_competence_tag.partner_profile_id",
        "rating_link.rater_partner_profile_id",
      ]);
    });
  });

  it("efter en sletning peger ingen række på personen (ud over det blankerede anker)", async () => {
    await asPostgres(async (client) => {
      await seedOwnerX(client);
      await erase(client, X, ADMIN);
      for (const ref of await referrers(client, "app_user")) {
        if (ref === "erasure_receipt.requested_by") continue;
        const [table, column] = ref.split(".");
        expect(await count(client, `select 1 from ${table} where ${column} = $1`, [X]), ref).toBe(0);
      }
    });
    await asPostgres(async (client) => {
      await seedPartnerY(client);
      await erase(client, Y, ADMIN, [removal(BOARD_Z, [P1, P3, PROFILE_Y], PROFILE_Y, P1)]);
      for (const ref of await referrers(client, "partner_profile")) {
        const [table, column] = ref.split(".");
        expect(await count(client, `select 1 from ${table} where ${column} = $1`, [PROFILE_Y]), ref).toBe(0);
      }
      for (const ref of await referrers(client, "app_user")) {
        if (ref === "erasure_receipt.requested_by") continue;
        const [table, column] = ref.split(".");
        expect(await count(client, `select 1 from ${table} where ${column} = $1`, [Y]), ref).toBe(0);
      }
    });
  });
});
