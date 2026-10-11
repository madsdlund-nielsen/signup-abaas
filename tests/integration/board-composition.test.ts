import { afterEach, describe, expect, it, vi } from "vitest";

import { recordBoardChange } from "@/server/boards/audit";
import { applyBoardChange, changeBoardComposition, HOSTS_WARNING } from "@/server/boards/composition";
import { syncBoardHosts } from "@/server/meetings/board-hosts";
import { DemoBookingProvider } from "@/lib/booking/demo";
import { boardTables, createFakeDb, FakeBookingProvider, IDS } from "./support/board-fakes";

/**
 * Sammensætningen og dens følgevirkninger (ADR 0062) mod en stateful fake af Supabase: invarianterne
 * afvises UDEN at skrive noget, lead flytter efter reglerne, og Cal.com-hosts opdateres bagefter
 * uden at en fejl kan rulle sammensætningen tilbage.
 */
const ADMIN = { id: IDS.admin, role: "admin" as const };

function memberIds(db: ReturnType<typeof createFakeDb>): string[] {
  return db.tables.board_partner.map((r) => r.partner_id as string).sort();
}
function leadIds(db: ReturnType<typeof createFakeDb>): string[] {
  return db.tables.board_partner.filter((r) => r.is_lead).map((r) => r.partner_id as string);
}

afterEach(() => vi.restoreAllMocks());

describe("changeBoardComposition — invarianter", () => {
  it("tilføj: tredje partner kommer på boardet, lead består", async () => {
    const db = createFakeDb(boardTables());
    await changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl });
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(leadIds(db)).toEqual([IDS.anna]);
  });

  it("NEGATIV: en fjerde partner afvises, og intet er skrevet", async () => {
    const db = createFakeDb(boardTables());
    await changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl });
    const before = JSON.stringify(db.tables.board_partner);
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.dorte }),
    ).rejects.toThrow(/2-3 partnere/);
    expect(JSON.stringify(db.tables.board_partner)).toBe(before);
  });

  it("NEGATIV: dublet afvises", async () => {
    const db = createFakeDb(boardTables());
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.anna }),
    ).rejects.toThrow(/allerede/);
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo]);
  });

  it("NEGATIV: et board under to partnere afvises", async () => {
    const db = createFakeDb(boardTables());
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "fjern", partnerId: IDS.bo }),
    ).rejects.toThrow(/2-3 partnere/);
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo]);
  });

  it("NEGATIV: den sidste interne kan ikke fjernes eller udskiftes med en ekstern", async () => {
    const db = createFakeDb(
      boardTables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
          { board_id: IDS.board, partner_id: IDS.erik, is_lead: false },
        ],
      }),
    );
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "fjern", partnerId: IDS.anna }),
    ).rejects.toThrow(/mindst én intern/);
    expect(leadIds(db)).toEqual([IDS.anna]);

    const small = createFakeDb(
      boardTables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
        ],
      }),
    );
    await expect(
      changeBoardComposition(small.client, ADMIN, IDS.board, { kind: "udskift", outgoingId: IDS.anna, incomingId: IDS.erik }),
    ).rejects.toThrow(/mindst én intern/);
    expect(memberIds(small)).toEqual([IDS.anna, IDS.carl]);
  });

  it("NEGATIV: ukendt partner afvises", async () => {
    const db = createFakeDb(boardTables());
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: "findes-ikke" }),
    ).rejects.toThrow(/Ukendt partner/);
  });

  it("NEGATIV: en ekstern kan ikke udpeges som lead", async () => {
    const db = createFakeDb(
      boardTables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
        ],
      }),
    );
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "saet_lead", partnerId: IDS.carl }),
    ).rejects.toThrow(/intern partner/);
    expect(leadIds(db)).toEqual([IDS.anna]);
  });

  it("NEGATIV: lead kan ikke gives til en partner der ikke sidder på boardet — og lead mistes ikke", async () => {
    const db = createFakeDb(boardTables());
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "saet_lead", partnerId: IDS.dorte }),
    ).rejects.toThrow(/ikke på boardet/);
    expect(leadIds(db)).toEqual([IDS.anna]);
  });

  it("sæt lead flytter markeringen: præcis én lead bagefter", async () => {
    const db = createFakeDb(boardTables());
    await changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "saet_lead", partnerId: IDS.bo });
    expect(leadIds(db)).toEqual([IDS.bo]);
  });
});

describe("changeBoardComposition — lead følger sammensætningen", () => {
  const withCarl = () =>
    createFakeDb(
      boardTables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.bo, is_lead: false },
          { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
        ],
      }),
    );

  it("fjern lead: markeringen går til den første interne", async () => {
    const db = withCarl();
    await changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "fjern", partnerId: IDS.anna });
    expect(memberIds(db)).toEqual([IDS.bo, IDS.carl]);
    expect(leadIds(db)).toEqual([IDS.bo]);
  });

  it("udskift lead med en intern: den indkommende bliver lead", async () => {
    const db = withCarl();
    await changeBoardComposition(db.client, ADMIN, IDS.board, {
      kind: "udskift",
      outgoingId: IDS.anna,
      incomingId: IDS.dorte,
    });
    expect(memberIds(db)).toEqual([IDS.bo, IDS.carl, IDS.dorte]);
    expect(leadIds(db)).toEqual([IDS.dorte]);
  });

  it("udskift lead med en ekstern: lead går til den første interne", async () => {
    const db = withCarl();
    await changeBoardComposition(db.client, ADMIN, IDS.board, {
      kind: "udskift",
      outgoingId: IDS.anna,
      incomingId: IDS.erik,
    });
    expect(leadIds(db)).toEqual([IDS.bo]);
  });

  it("udskift en ikke-lead: lead består uændret", async () => {
    const db = withCarl();
    await changeBoardComposition(db.client, ADMIN, IDS.board, {
      kind: "udskift",
      outgoingId: IDS.carl,
      incomingId: IDS.erik,
    });
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo, IDS.erik]);
    expect(leadIds(db)).toEqual([IDS.anna]);
  });

  it("et board uden lead (ældre data) får en intern lead ved første ændring", async () => {
    const db = createFakeDb(
      boardTables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: false },
          { board_id: IDS.board, partner_id: IDS.bo, is_lead: false },
        ],
      }),
    );
    await changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl });
    expect(leadIds(db)).toEqual([IDS.anna]);
  });
});

describe("applyBoardChange — Cal.com-hosts og revisionsspor", () => {
  it("opdaterer hosts med boardets nye partnere, gemmer id'et og logger 'opdateret'", async () => {
    const db = createFakeDb(boardTables());
    const booking = new FakeBookingProvider();

    const { hosts } = await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, booking);

    expect(hosts).toEqual({ status: "opdateret", eventTypeId: 4242 });
    expect(booking.upserts).toHaveLength(1);
    expect(booking.upserts[0]).toMatchObject({ eventTypeId: 4242, slug: `abaas-board-${IDS.board}` });
    expect([...(booking.upserts[0]?.hostUserIds ?? [])].sort()).toEqual([11, 12, 13]);
    expect(db.tables.board_change).toEqual([
      expect.objectContaining({
        board_id: IDS.board,
        actor_id: IDS.admin,
        actor_role: "admin",
        action: "tilfoej",
        partner_id: IDS.carl,
        replaced_partner_id: null,
        calcom_sync: "opdateret",
      }),
    ]);
  });

  it("udskift logger både indkommende og udgående partner", async () => {
    const db = createFakeDb(boardTables());
    await applyBoardChange(
      db.client,
      { id: IDS.owner, role: "ejer" },
      IDS.board,
      { kind: "udskift", outgoingId: IDS.bo, incomingId: IDS.dorte },
      new FakeBookingProvider(),
    );
    expect(db.tables.board_change[0]).toMatchObject({
      actor_role: "ejer",
      action: "udskift",
      partner_id: IDS.dorte,
      replaced_partner_id: IDS.bo,
    });
  });

  it("Cal.com-fejl ruller IKKE sammensætningen tilbage: ændringen står, fejlen returneres og logges", async () => {
    const db = createFakeDb(boardTables());
    const booking = new FakeBookingProvider();
    booking.failWith = new Error("Cal.com svarede 500");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const { hosts } = await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, booking);

    expect(hosts).toEqual({ status: "fejlet", message: "Cal.com svarede 500" });
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(db.tables.board_change[0]).toMatchObject({ action: "tilfoej", calcom_sync: "fejlet" });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(IDS.board));
  });

  it("en partner uden Cal.com-sæde gør hosts-opdateringen til en højlydt fejl — ændringen står", async () => {
    const db = createFakeDb(boardTables());
    const booking = new FakeBookingProvider();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { hosts } = await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.erik }, booking);

    expect(hosts.status).toBe("fejlet");
    expect(hosts.status === "fejlet" && hosts.message).toMatch(/Erik/);
    expect(booking.upserts).toEqual([]);
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo, IDS.erik]);
  });

  it("et board uden event type springes over (intet at opdatere endnu)", async () => {
    const db = createFakeDb(
      boardTables({ board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: IDS.owner, calcom_event_type_id: null }] }),
    );
    const booking = new FakeBookingProvider();

    const { hosts } = await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, booking);

    expect(hosts).toEqual({ status: "sprunget_over", reason: "ikke_koblet" });
    expect(booking.upserts).toEqual([]);
    expect(db.tables.board_change[0]).toMatchObject({ calcom_sync: "sprunget_over" });
  });

  it("demo-tilstand: Cal.com røres ikke, og det falske id gemmes aldrig", async () => {
    const db = createFakeDb(boardTables());
    const { hosts } = await applyBoardChange(
      db.client,
      ADMIN,
      IDS.board,
      { kind: "tilfoej", partnerId: IDS.carl },
      new DemoBookingProvider(),
    );
    expect(hosts).toEqual({ status: "sprunget_over", reason: "demo" });
    expect(db.tables.board[0]?.calcom_event_type_id).toBe(4242);
  });

  it("sæt lead ændrer ikke værterne: Cal.com kaldes ikke", async () => {
    const db = createFakeDb(boardTables());
    const booking = new FakeBookingProvider();
    const { hosts } = await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "saet_lead", partnerId: IDS.bo }, booking);
    expect(hosts).toEqual({ status: "sprunget_over", reason: "ikke_relevant" });
    expect(booking.upserts).toEqual([]);
    expect(db.tables.board_change[0]).toMatchObject({ action: "saet_lead", partner_id: IDS.bo });
  });

  it("NEGATIV: en afvist ændring skriver hverken sammensætning, Cal.com eller revisionsspor", async () => {
    const db = createFakeDb(boardTables());
    const booking = new FakeBookingProvider();
    await expect(
      applyBoardChange(db.client, ADMIN, IDS.board, { kind: "fjern", partnerId: IDS.bo }, booking),
    ).rejects.toThrow();
    expect(booking.upserts).toEqual([]);
    expect(db.tables.board_change).toEqual([]);
  });

  it("en fejl i selve skrivningen kastes højlydt (ikke slugt) og logger intet", async () => {
    const db = createFakeDb(boardTables());
    db.failures["rpc.change_board_composition"] = "disk fuld";
    await expect(
      applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, new FakeBookingProvider()),
    ).rejects.toThrow(/disk fuld/);
    expect(db.tables.board_change).toEqual([]);
  });
});

describe("atomisk skrivning (B-66, ADR 0064)", () => {
  it("planen sendes som ÉT kald med det læste udgangspunkt, aktøren og handlingen — og revisionsrækken kommer fra samme kald", async () => {
    const db = createFakeDb(boardTables());
    const rpc = vi.spyOn(db.client, "rpc");

    const { changeId } = await changeBoardComposition(db.client, ADMIN, IDS.board, {
      kind: "udskift",
      outgoingId: IDS.bo,
      incomingId: IDS.dorte,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("change_board_composition", {
      p_board_id: IDS.board,
      p_expected_partner_ids: [IDS.anna, IDS.bo],
      p_add: [IDS.dorte],
      p_remove: [IDS.bo],
      p_lead_id: IDS.anna,
      p_actor_id: IDS.admin,
      p_actor_role: "admin",
      p_action: "udskift",
      p_partner_id: IDS.dorte,
      p_replaced_partner_id: IDS.bo,
    });
    expect(db.tables.board_change.map((r) => r.id)).toEqual([changeId]);
  });

  it("NEGATIV: en samtidig ændring (forældet udgangspunkt) afvises af basen, og intet er skrevet", async () => {
    const db = createFakeDb(boardTables());
    db.failures["rpc.change_board_composition"] = {
      message: "Boardet blev ændret af en anden imens — genindlæs og prøv igen.",
      code: "40001",
    };
    await expect(
      applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, new FakeBookingProvider()),
    ).rejects.toThrow(/ændret af en anden/);
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo]);
    expect(db.tables.board_change).toEqual([]);
  });

  it("NEGATIV: basens sidste værn kan afvise en plan koden lod passere — højlydt, uden revisionsspor", async () => {
    // Koden og basen er uenige (fx en forældet læsning af is_internal): basens afvisning vinder, og
    // dens danske besked når brugeren uændret.
    const db = createFakeDb(boardTables());
    db.failures["rpc.change_board_composition"] = "Et board skal have mindst én intern partner.";
    await expect(
      changeBoardComposition(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }),
    ).rejects.toThrow(/mindst én intern/);
    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo]);
    expect(db.tables.board_change).toEqual([]);
  });

  it("Cal.com-udfaldet rettes på den række funktionen skrev (pessimistisk 'fejlet' → faktisk udfald)", async () => {
    const db = createFakeDb(boardTables());
    const rpcRow = async () => {
      await applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, new FakeBookingProvider());
      return db.tables.board_change[0];
    };
    expect(await rpcRow()).toMatchObject({ action: "tilfoej", calcom_sync: "opdateret" });
  });

  it("et fejlet udfalds-update vælter ikke ændringen: rækken står pessimistisk, fejlen logges uden persondata", async () => {
    const db = createFakeDb(boardTables());
    db.failures["board_change.update"] = "RLS sagde nej";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyBoardChange(db.client, ADMIN, IDS.board, { kind: "tilfoej", partnerId: IDS.carl }, new FakeBookingProvider()),
    ).resolves.toBeDefined();

    expect(memberIds(db)).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(db.tables.board_change[0]).toMatchObject({ calcom_sync: "fejlet" });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("RLS sagde nej"));
    expect(String(errors.mock.calls[0]?.[0])).not.toContain(IDS.admin);
  });
});

describe("recordBoardChange", () => {
  it("et fejlet revisionsspor vælter ikke handlingen — det logges uden persondata", async () => {
    const db = createFakeDb(boardTables());
    db.failures["board_change.insert"] = "RLS sagde nej";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordBoardChange(db.client, { boardId: IDS.board, actor: ADMIN, action: "fjern", calcomSync: "sprunget_over" }),
    ).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledWith(expect.stringContaining("RLS sagde nej"));
    expect(String(errors.mock.calls[0]?.[0])).not.toContain(IDS.admin);
  });
});

describe("syncBoardHosts — admins knap (createIfMissing)", () => {
  it("opretter event typen når boardet ingen har, og gemmer id'et", async () => {
    const db = createFakeDb(
      boardTables({ board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: IDS.owner, calcom_event_type_id: null }] }),
    );
    const booking = new FakeBookingProvider();
    const result = await syncBoardHosts(db.client, IDS.board, { createIfMissing: true }, booking);
    expect(result).toEqual({ status: "opdateret", eventTypeId: 9001 });
    expect(db.tables.board[0]?.calcom_event_type_id).toBe(9001);
  });

  it("et event type der allerede hører til et andet board giver en dansk besked", async () => {
    const db = createFakeDb(boardTables());
    db.failures["board.update"] = { message: "duplicate", code: "23505" };
    const result = await syncBoardHosts(db.client, IDS.board, { createIfMissing: true }, new FakeBookingProvider());
    expect(result).toEqual({ status: "fejlet", message: expect.stringMatching(/andet board/) });
  });

  it("ukendt board", async () => {
    const db = createFakeDb(boardTables());
    expect(await syncBoardHosts(db.client, "findes-ikke", { createIfMissing: true }, new FakeBookingProvider())).toEqual({
      status: "fejlet",
      message: "Board ikke fundet.",
    });
  });
});

describe("HOSTS_WARNING", () => {
  it("er den tekst admin får at se", () => {
    expect(HOSTS_WARNING).toBe("Cal.com-hosts ikke opdateret — kør Opdatér hosts.");
  });
});
