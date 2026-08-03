import { describe, expect, it } from "vitest";
import { getMyBoard } from "@/server/boards";
import { getBoardRecommendation, getMyCompetenceTagIds, listMatchCandidates } from "@/server/matching";

/**
 * Board-matchingens data-access uden Supabase-konfiguration (kontofri CI/dev). Samme kontrakt som
 * tags/quiz/partners: læsning degraderer til tom/null frem for at kaste, så siderne stadig rendrer.
 */
describe("board- og matching-data-access uden Supabase-konfiguration", () => {
  it("getMyBoard returnerer null når nøgler mangler", async () => {
    await expect(getMyBoard({})).resolves.toBeNull();
  });

  it("getMyCompetenceTagIds returnerer [] når nøgler mangler", async () => {
    await expect(getMyCompetenceTagIds({})).resolves.toEqual([]);
  });

  it("listMatchCandidates returnerer [] når nøgler mangler (uden at kræve en rolle)", async () => {
    await expect(listMatchCandidates({})).resolves.toEqual([]);
  });

  it("getBoardRecommendation giver et tomt board frem for at kaste", async () => {
    const recommendation = await getBoardRecommendation({});

    expect(recommendation.selected).toEqual([]);
    expect(recommendation.pool).toEqual([]);
    expect(recommendation.match.partnerIds).toEqual([]);
    expect(recommendation.match.hasInternalPartner).toBe(false);
  });
});
