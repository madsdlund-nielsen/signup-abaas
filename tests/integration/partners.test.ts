import { describe, expect, it } from "vitest";
import { getPartner, listPartners } from "@/server/partners";

describe("partner data-access uden Supabase-konfiguration", () => {
  it("listPartners returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(listPartners({})).resolves.toEqual([]);
  });

  it("getPartner returnerer null når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(getPartner("00000000-0000-0000-0000-0000000e0001", {})).resolves.toBeNull();
  });
});
