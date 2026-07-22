import { describe, expect, it } from "vitest";
import { listTags } from "@/server/tags";

describe("tags data-access uden Supabase-konfiguration", () => {
  it("listTags returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(listTags({})).resolves.toEqual([]);
  });
});
