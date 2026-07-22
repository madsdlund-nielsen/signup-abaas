import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import type { QuizQuestionDetail } from "@/server/quiz";

function option(
  id: string,
  label: string,
  kind: "tag" | "free_text" | "frequency",
  frequencyWeeks: number | null = null,
): QuizQuestionDetail["options"][number] {
  return { id, label, kind, frequencyWeeks, sortOrder: 0, competenceTagIds: [] };
}

const QUESTIONS: QuizQuestionDetail[] = [
  {
    id: "q1",
    key: "kompetencer",
    prompt: "Hvilke kompetencer?",
    kind: "multi",
    sortOrder: 1,
    isPublished: true,
    options: [option("a", "Salg", "tag"), option("ft", "Andre kompetencer", "free_text")],
  },
  {
    id: "q2",
    key: "frekvens",
    prompt: "Hvor ofte?",
    kind: "single",
    sortOrder: 2,
    isPublished: true,
    options: [option("f8", "Frekvens", "frequency", 8), option("f12", "Frekvens", "frequency", 12)],
  },
];

describe("OnboardingFlow — conversational ejer-flow", () => {
  it("gater Videre til spørgsmålet er besvaret og navigerer trin for trin", () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByRole } = render(
      <OnboardingFlow questions={QUESTIONS} initialAnswers={[]} action={action} />,
    );
    expect(getByText("Spørgsmål 1 af 2")).toBeTruthy();
    const videre = getByRole("button", { name: "Videre" }) as HTMLButtonElement;
    expect(videre.disabled).toBe(true);

    fireEvent.click(getByRole("button", { name: "Salg" }));
    expect(videre.disabled).toBe(false);
    fireEvent.click(videre);

    expect(getByText("Spørgsmål 2 af 2")).toBeTruthy();
    const gem = getByRole("button", { name: "Gem svar" }) as HTMLButtonElement;
    expect(gem.disabled).toBe(true);
  });

  it("gemmer de valgte svar og viser kvittering", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { getByRole, findByText } = render(
      <OnboardingFlow questions={QUESTIONS} initialAnswers={[]} action={action} />,
    );
    fireEvent.click(getByRole("button", { name: "Salg" }));
    fireEvent.click(getByRole("button", { name: "Videre" }));
    fireEvent.click(getByRole("button", { name: "Hver 8. uge" }));
    fireEvent.click(getByRole("button", { name: "Gem svar" }));

    expect(await findByText("Tak")).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith([{ optionId: "a" }, { optionId: "f8" }]);
  });

  it("fritekst tæller som svar og sendes med", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { getByRole, getByPlaceholderText, findByText } = render(
      <OnboardingFlow questions={[QUESTIONS[0]]} initialAnswers={[]} action={action} />,
    );
    const gem = getByRole("button", { name: "Gem svar" }) as HTMLButtonElement;
    expect(gem.disabled).toBe(true);
    fireEvent.change(getByPlaceholderText("Andre kompetencer"), { target: { value: "eksport" } });
    expect(gem.disabled).toBe(false);
    fireEvent.click(gem);

    expect(await findByText("Tak")).toBeTruthy();
    expect(action).toHaveBeenCalledWith([{ optionId: "ft", freeText: "eksport" }]);
  });

  it("prefiller fra tidligere svar (option forvalgt)", () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = render(
      <OnboardingFlow
        questions={QUESTIONS}
        initialAnswers={[{ optionId: "a", freeText: null }]}
        action={action}
      />,
    );
    expect(getByRole("button", { name: "Salg" }).getAttribute("aria-pressed")).toBe("true");
    expect((getByRole("button", { name: "Videre" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
