import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  partnerC: "00000000-0000-0000-0000-00000000000c",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";

async function visibleBoardCount(sub: string): Promise<number> {
  return asUser(sub, async (client) => {
    const res = await client.query("select id from board where id = $1", [BOARD]);
    return res.rowCount ?? 0;
  });
}

describe("RLS: board-synlighed", () => {
  it("ejer ser eget board", async () => {
    expect(await visibleBoardCount(USER.ejerA)).toBe(1);
  });

  it("admin ser alle boards", async () => {
    expect(await visibleBoardCount(USER.adminD)).toBe(1);
  });

  // 0010 fjernede board_select_partner: board_partner.partner_id peger nu på en katalogpost
  // (partner_profile), ikke på en auth-bruger, så en partner kan ikke længere identificere sig selv
  // via medlemskabet. Partner-synlighed genindføres i Fase 2 sammen med partner-login.
  // TODO(mads): partner-login — genindfør board_select_partner via partner_profile.app_user_id.
  it("NEGATIV: partner ser intet board (partner-synlighed venter på partner-login, ADR 0021)", async () => {
    expect(await visibleBoardCount(USER.partnerB)).toBe(0);
    expect(await visibleBoardCount(USER.partnerC)).toBe(0);
  });

  it("NEGATIV: anden ejer ser ikke et fremmed board", async () => {
    expect(await visibleBoardCount(USER.ejerE)).toBe(0);
  });
});
