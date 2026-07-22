import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { QuizRenderer } from "@/components/QuizRenderer";
import { QuestionPreviewForm } from "@/components/QuestionPreviewForm";

const noop = async () => {};

describe("QuizRenderer (ejer-look, kun token-klasser)", () => {
  it("rendrer prompt + option-knapper med token-klasser og ingen inline-style", () => {
    const { getByRole, getByText } = render(
      <QuizRenderer
        question={{
          prompt: "Hvilke kompetencer?",
          kind: "multi",
          options: [
            { id: "1", label: "Salg", kind: "tag" },
            { id: "2", label: "Økonomi", kind: "tag" },
          ],
        }}
      />,
    );
    expect(getByText("Hvilke kompetencer?")).toBeTruthy();
    const btn = getByRole("button", { name: "Salg" });
    expect(btn.className).toBe("quiz__option");
    expect(btn.getAttribute("style")).toBeNull();
  });

  it("frekvens-option viser 'Hver N. uge'; fritekst-option rendres som input", () => {
    const { getByRole, getByPlaceholderText } = render(
      <QuizRenderer
        question={{
          prompt: "Frekvens?",
          kind: "single",
          options: [
            { id: "f", label: "Frekvens", kind: "frequency", frequencyWeeks: 8 },
            { id: "t", label: "Andet", kind: "free_text" },
          ],
        }}
      />,
    );
    expect(getByRole("button", { name: "Hver 8. uge" })).toBeTruthy();
    expect((getByPlaceholderText("Andet") as HTMLInputElement).readOnly).toBe(true);
  });

  it("enkelt-valg: nyt valg erstatter forrige (aria-pressed)", () => {
    const { getByRole } = render(
      <QuizRenderer
        question={{
          prompt: "Vælg én",
          kind: "single",
          options: [
            { id: "a", label: "A", kind: "tag" },
            { id: "b", label: "B", kind: "tag" },
          ],
        }}
      />,
    );
    const a = getByRole("button", { name: "A" });
    const b = getByRole("button", { name: "B" });
    fireEvent.click(a);
    expect(a.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(b);
    expect(a.getAttribute("aria-pressed")).toBe("false");
    expect(b.getAttribute("aria-pressed")).toBe("true");
  });

  it("multi-valg: flere kan vælges samtidig", () => {
    const { getByRole } = render(
      <QuizRenderer
        question={{
          prompt: "Vælg flere",
          kind: "multi",
          options: [
            { id: "a", label: "A", kind: "tag" },
            { id: "b", label: "B", kind: "tag" },
          ],
        }}
      />,
    );
    const a = getByRole("button", { name: "A" });
    const b = getByRole("button", { name: "B" });
    fireEvent.click(a);
    fireEvent.click(b);
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("QuestionPreviewForm — preview inden gem", () => {
  it("preview er skjult indtil toggle; viser derefter aktuel prompt live", () => {
    const { getByRole, queryByText, getByLabelText } = render(
      <QuestionPreviewForm
        action={noop}
        questionId="q1"
        initialPrompt="Oprindelig prompt"
        initialKind="multi"
        initialPublished={false}
        options={[{ id: "1", label: "Salg", kind: "tag" }]}
      />,
    );
    // Skjult før toggle: prompt findes kun i textarea, ikke som overskrift.
    expect(queryByText("Oprindelig prompt", { selector: "h3" })).toBeNull();

    fireEvent.click(getByRole("button", { name: "Vis preview (inden gem)" }));
    expect(queryByText("Oprindelig prompt", { selector: "h3" })).toBeTruthy();

    // Live-opdatering: ændr prompt → preview følger med.
    fireEvent.change(getByLabelText("Spørgsmålstekst"), { target: { value: "Ny prompt" } });
    expect(queryByText("Ny prompt", { selector: "h3" })).toBeTruthy();
  });
});
