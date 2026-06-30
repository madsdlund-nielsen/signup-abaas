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

  it("partner på boardet ser boardet", async () => {
    expect(await visibleBoardCount(USER.partnerB)).toBe(1);
  });

  it("admin ser alle boards", async () => {
    expect(await visibleBoardCount(USER.adminD)).toBe(1);
  });

  it("NEGATIV: partner uden for boardet ser intet", async () => {
    expect(await visibleBoardCount(USER.partnerC)).toBe(0);
  });

  it("NEGATIV: anden ejer ser ikke et fremmed board", async () => {
    expect(await visibleBoardCount(USER.ejerE)).toBe(0);
  });
});
