import { describe, expect, it } from "vitest";

import { summarise, type RatingSummaryRow } from "@/server/ratings/summary";

/**
 * Ren aggregering (fase 4.2, ADR 0038). Importeres fra @/server/ratings/summary og ikke fra
 * modulets index, netop fordi den er fri for Supabase — samme opdeling som pricing/algorithm.
 */
function row(
  partnerId: string,
  score: number,
  name: string | null = "Partner Én",
): RatingSummaryRow {
  return {
    subject_partner_profile_id: partnerId,
    score,
    partner_profile: name === null ? null : { name },
  };
}

describe("summarise — aggregering pr. rådgiver", () => {
  it("tomt input giver tomt resultat", () => {
    expect(summarise([])).toEqual([]);
  });

  it("tæller og gennemsnitter pr. partner", () => {
    const result = summarise([row("p1", 5), row("p1", 4), row("p2", 3, "Partner To")]);

    expect(result).toEqual([
      { partnerProfileId: "p1", name: "Partner Én", count: 2, average: 4.5 },
      { partnerProfileId: "p2", name: "Partner To", count: 1, average: 3 },
    ]);
  });

  it("afrunder gennemsnittet til én decimal", () => {
    // 5+4+4 = 13/3 = 4,333… → 4,3. Ikke 4,33: en ekstra decimal foregiver en præcision
    // som tre heltalsvurderinger ikke har.
    expect(summarise([row("p1", 5), row("p1", 4), row("p1", 4)])).toEqual([
      { partnerProfileId: "p1", name: "Partner Én", count: 3, average: 4.3 },
    ]);
  });

  it("accepterer relationen som array — Supabase returnerer begge former", () => {
    const nested: RatingSummaryRow = {
      subject_partner_profile_id: "p1",
      score: 4,
      partner_profile: [{ name: "Partner Én" }],
    };
    expect(summarise([nested]).map((r) => r.name)).toEqual(["Partner Én"]);
  });

  it("falder tilbage til en ærlig etiket når navnet mangler", () => {
    expect(summarise([row("p1", 4, null)]).map((r) => r.name)).toEqual(["Ukendt partner"]);
  });

  it("sorterer på navn med dansk kollation — å efter z", () => {
    const result = summarise([
      row("p1", 4, "Ærø"),
      row("p2", 4, "Zahle"),
      row("p3", 4, "Bang"),
    ]);
    expect(result.map((r) => r.name)).toEqual(["Bang", "Zahle", "Ærø"]);
  });
});
