import { describe, expect, it } from "vitest";
import { getQuestionDetail, listPublishedQuestions, listQuestions } from "@/server/quiz";
import { getMyAnswers } from "@/server/quiz/answers";

describe("quiz data-access uden Supabase-konfiguration", () => {
  it("listQuestions returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(listQuestions({})).resolves.toEqual([]);
  });

  it("getQuestionDetail returnerer null når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(getQuestionDetail("00000000-0000-0000-0000-0000000c0001", {})).resolves.toBeNull();
  });

  it("listPublishedQuestions returnerer [] når nøgler mangler (ejer-flow, kontofri)", async () => {
    await expect(listPublishedQuestions({})).resolves.toEqual([]);
  });

  it("getMyAnswers returnerer [] når nøgler mangler (kontofri CI/dev)", async () => {
    await expect(getMyAnswers({})).resolves.toEqual([]);
  });
});
