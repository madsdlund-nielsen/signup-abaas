import { describe, expect, it } from "vitest";
import { listQuestions } from "@/server/quiz";

describe("quiz data-access uden Supabase-konfiguration", () => {
  it("listQuestions returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(listQuestions({})).resolves.toEqual([]);
  });
});
