import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/server/auth";
import { listFeeLines, listFeeRules, listMyFeeLines } from "@/server/fees";
import { GET } from "@/app/admin/honorar/eksport/route";

// Sessionen mockes, så eksport-ruten kan afprøves som anonym/ejer/partner/admin uden Supabase.
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => session.user,
}));

function userWith(...roles: AuthUser["roles"]): AuthUser {
  return { id: "u1", email: "u1@example.com", roles };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/admin/honorar/eksport${query}`));
}

describe("honorar-data-access uden Supabase-konfiguration (kontofri CI/dev)", () => {
  it("returnerer tomme lister frem for at gætte", async () => {
    const period = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };
    await expect(listFeeRules({})).resolves.toEqual([]);
    await expect(listMyFeeLines(period, {})).resolves.toEqual([]);
    await expect(listFeeLines(period, {})).resolves.toEqual([]);
  });
});

describe("/admin/honorar/eksport — admin-tjek server-side (ruten ligger uden for admin-layoutet)", () => {
  beforeEach(() => {
    session.user = null;
  });

  it("NEGATIV: ikke logget ind → 401, intet læses", async () => {
    const response = await get("?maaned=2026-10");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type") ?? "").not.toContain("text/csv");
  });

  it("NEGATIV: ejer, partner og lead-partner → 403", async () => {
    for (const role of ["ejer", "partner", "lead_partner"] as const) {
      session.user = userWith(role);
      expect((await get("?maaned=2026-10")).status).toBe(403);
    }
  });

  it("NEGATIV: ugyldigt partner-id afvises med 400", async () => {
    session.user = userWith("admin");
    expect((await get("?partner=1%27%20or%201%3D1")).status).toBe(400);
  });

  it("admin → CSV med BOM, korrekt filnavn og kun headeren når intet er læsbart", async () => {
    session.user = userWith("admin");
    const response = await get("?maaned=2026-10");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="honorar-2026-10.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");

    // text() fjerner en BOM, så de rå bytes tjekkes: EF BB BF = UTF-8 BOM (Excel og æ/ø/å).
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(body.startsWith("\uFEFFmaaned,partner_id,partner,moede_id")).toBe(true);
    expect(body.trimEnd().split("\r\n")).toHaveLength(1);
  });

  it("ugyldig måned falder tilbage til indeværende måned i filnavnet", async () => {
    session.user = userWith("admin");
    const response = await get("?maaned=pjat");
    expect(response.headers.get("content-disposition")).toMatch(/honorar-\d{4}-\d{2}\.csv/);
  });
});
