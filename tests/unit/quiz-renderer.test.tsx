import { describe, expect, it, vi } from "vitest";
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

describe("QuizRenderer (kontrolleret tilstand — ejer-flow)", () => {
  it("afspejler `selected` og kalder `onToggle` uden at ændre intern state", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(
      <QuizRenderer
        question={{
          prompt: "Vælg",
          kind: "multi",
          options: [
            { id: "a", label: "A", kind: "tag" },
            { id: "b", label: "B", kind: "tag" },
          ],
        }}
        selected={["a"]}
        onToggle={onToggle}
      />,
    );
    const a = getByRole("button", { name: "A" });
    const b = getByRole("button", { name: "B" });
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledWith("b");
    // Kontrolleret: intern state ændrer ikke visningen (b forbliver ikke-valgt uden ny prop).
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("free_text er redigerbar med `onFreeText` (ellers readOnly)", () => {
    const onFreeText = vi.fn();
    const { getByPlaceholderText } = render(
      <QuizRenderer
        question={{
          prompt: "Andet?",
          kind: "multi",
          options: [{ id: "ft", label: "Andre kompetencer", kind: "free_text" }],
        }}
        freeText={{ ft: "start" }}
        onFreeText={onFreeText}
      />,
    );
    const input = getByPlaceholderText("Andre kompetencer") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("start");
    fireEvent.change(input, { target: { value: "eksport" } });
    expect(onFreeText).toHaveBeenCalledWith("ft", "eksport");
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
