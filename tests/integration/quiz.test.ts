import { describe, expect, it } from "vitest";
import { getQuestionDetail, listQuestions } from "@/server/quiz";

describe("quiz data-access uden Supabase-konfiguration", () => {
  it("listQuestions returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(listQuestions({})).resolves.toEqual([]);
  });

  it("getQuestionDetail returnerer null når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(getQuestionDetail("00000000-0000-0000-0000-0000000c0001", {})).resolves.toBeNull();
  });
});
