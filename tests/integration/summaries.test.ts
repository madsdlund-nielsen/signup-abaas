import { describe, expect, it } from "vitest";
import { getMeetingSummary } from "@/server/summaries";

/**
 * Skærm-først (fase 4.4): datakilden går gennem portene, så adfærden følger adapter-valget
 * i ADR 0041 — demo når rigtig config mangler, synligt hul når alt er stub.
 */
describe("getMeetingSummary — opsummering gennem portene", () => {
  it("giver en [DEMO]-mærket opsummering med handlingspunkter i demo-tilstand", async () => {
    const state = await getMeetingSummary("m-1", { FLAG_DEMO: "true" });
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.source).toBe("demo");
    expect(state.summary.startsWith("[DEMO]")).toBe(true);
    expect(state.actionItems.length).toBeGreaterThan(0);
    for (const item of state.actionItems) expect(item.startsWith("[DEMO]")).toBe(true);
  });

  it("er et synligt hul — ikke et gæt — når adapterne er stubs", async () => {
    const state = await getMeetingSummary("m-1", {});
    expect(state.kind).toBe("unavailable");
    if (state.kind !== "unavailable") return;
    expect(state.reason).toMatch(/ikke konfigureret/);
  });
});
