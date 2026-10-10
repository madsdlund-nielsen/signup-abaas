import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

/**
 * Læsevejene bag rolle-dashboardene (fase 5.4, ADR 0055). Ingen ny tabel og ingen ny policy —
 * disse tests fastholder de RLS-grænser dashboardet hviler på:
 *
 *  - Lead-partnerens kompetenceoverblik kan IKKE læse ejerens behov via RLS (quiz_answer er
 *    ejer + admin). Derfor findes service-role-læsevejen `getLeadBoardNeeds`, bag et lead-tjek.
 *    Hvis nogen en dag åbner quiz_answer for partnere, skal testen fejle højlydt og ADR 0055
 *    revurderes.
 *  - Partnerens egne vurderinger er IKKE læsbare (meeting_rating er rater + admin), så
 *    dashboardet viser dem ikke. Åbnes policyen, er "hullet" lukket og panelet kan få et tal.
 *  - Det dashboardet LÆSER via RLS (boardets medlemmer og deres tags, egne møder) er synligt for
 *    partneren på sit eget board — og kun dér.
 *
 * Seed (tests/setup/seed.sql): Partner Én (e0001, koblet til partner-B) er LEAD på ejer-A's
 * board. Ejer-A har ét quiz-svar og to vurderinger af/om Partner Én.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b", // = Partner Én, lead
  partnerC: "00000000-0000-0000-0000-00000000000c", // ukoblet
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const PARTNER_ONE = "00000000-0000-0000-0000-0000000e0001";
const BOARD_A = "00000000-0000-0000-0000-0000000b0a4d";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("lead-partnerens behovslæsning — RLS lukker, derfor service-role bag lead-tjek", () => {
  it("NEGATIV: lead-partneren kan ikke læse ejerens quiz-svar via RLS", async () => {
    expect(await countAs(USER.partnerB, "select id from quiz_answer")).toBe(0);
  });

  it("NEGATIV: en ukoblet partner kan heller ikke", async () => {
    expect(await countAs(USER.partnerC, "select id from quiz_answer")).toBe(0);
  });

  it("NEGATIV: en fremmed ejer ser ikke ejer-A's svar", async () => {
    expect(await countAs(USER.ejerE, "select id from quiz_answer")).toBe(0);
  });

  it("positiv: ejeren selv og admin kan (grundlaget for at behovene findes)", async () => {
    expect(await countAs(USER.ejerA, "select id from quiz_answer")).toBe(1);
    expect(await countAs(USER.adminD, "select id from quiz_answer")).toBe(1);
  });

  it("lead-tjekket i data: is_lead er sat for Partner Én på ejer-A's board", async () => {
    // Samme betingelse som getLeadBoardNeeds' service-role-opslag (board + partner + is_lead).
    const rows = await countAs(
      USER.adminD,
      `select 1 from board_partner where board_id = '${BOARD_A}' and partner_id = '${PARTNER_ONE}' and is_lead`,
    );
    expect(rows).toBe(1);
  });
});

describe("partnerens egne vurderinger — ikke læsbare, derfor intet tal på dashboardet", () => {
  it("NEGATIV: partneren kan ikke læse ejerens vurdering AF sig selv", async () => {
    expect(
      await countAs(
        USER.partnerB,
        `select id from meeting_rating where subject_partner_profile_id = '${PARTNER_ONE}' and rater_user_id is not null`,
      ),
    ).toBe(0);
  });

  it("partneren ser kun vurderinger han selv har afgivet", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting_rating")).toBe(1);
  });

  it("positiv: admin kan læse dem (aggregeringen bor på /admin/vurderinger)", async () => {
    expect(
      await countAs(
        USER.adminD,
        `select id from meeting_rating where subject_partner_profile_id = '${PARTNER_ONE}'`,
      ),
    ).toBe(1);
  });
});

describe("det dashboardet læser via RLS", () => {
  it("partneren ser sit eget boards medlemmer og deres tags", async () => {
    expect(await countAs(USER.partnerB, "select board_id from board_partner")).toBe(1);
    expect(
      await countAs(USER.partnerB, "select competence_tag_id from partner_profile_competence_tag"),
    ).toBe(1);
  });

  it("NEGATIV: en ukoblet partner ser hverken board eller medlemmer", async () => {
    expect(await countAs(USER.partnerC, "select id from board")).toBe(0);
    expect(await countAs(USER.partnerC, "select board_id from board_partner")).toBe(0);
  });

  it("NEGATIV: en fremmed ejer ser ikke ejer-A's medlemskab eller møder", async () => {
    expect(await countAs(USER.ejerE, "select id from membership")).toBe(0);
    expect(await countAs(USER.ejerE, "select id from meeting")).toBe(0);
  });

  it("ejer-A ser sit eget medlemskab og sine møder", async () => {
    expect(await countAs(USER.ejerA, "select id from membership")).toBe(1);
    expect(await countAs(USER.ejerA, "select id from meeting")).toBe(2);
  });
});
