import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { OptionsSection } from "@/components/OptionsSection";
import type { QuizOption } from "@/server/quiz";
import type { CompetenceTag } from "@/server/tags";

/**
 * Svarmuligheder på quiz-spørgsmål (admin, /admin/quiz/[id]). Server-actions kommer ind som props,
 * så komponenten importerer ingen server-modul — vi giver den `vi.fn()` i stedet for `vi.mock`.
 * Testværdierne er syntetiske.
 */
function option(
  id: string,
  label: string,
  overrides: Partial<QuizOption> = {},
): QuizOption {
  return {
    id,
    label,
    kind: "tag",
    frequencyWeeks: null,
    sortOrder: 0,
    competenceTagIds: [],
    ...overrides,
  };
}

const tags: CompetenceTag[] = [
  { id: "t1", slug: "salg", label: "Salg", sortOrder: 1 },
  { id: "t2", slug: "drift", label: "Drift", sortOrder: 2 },
];

function setup(options: QuizOption[], reorderOptions = vi.fn(async () => {})) {
  const actions = {
    updateOption: vi.fn(),
    deleteOption: vi.fn(),
    moveOption: vi.fn(),
    setOptionTags: vi.fn(),
  };
  const utils = render(
    <OptionsSection
      questionId="q1"
      options={options}
      tags={tags}
      reorderOptions={reorderOptions}
      {...actions}
    />,
  );
  return { ...utils, reorderOptions };
}

function listItems(container: HTMLElement) {
  return Array.from(container.querySelectorAll("li.option-item"));
}

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`index ${index} findes ikke`);
  return item;
}

function submittedFormData(reorder: {
  mock: { calls: unknown[][] };
}): FormData {
  const args = reorder.mock.calls[0];
  if (!args) throw new Error("reorderOptions blev ikke kaldt");
  return args[0] as FormData;
}

function labelsInOrder(container: HTMLElement) {
  return listItems(container).map(
    (li) => li.querySelector(".body")?.textContent,
  );
}

describe("OptionsSection — render", () => {
  it("viser en tom-tilstand når der ingen svarmuligheder er", () => {
    const { getByText, container } = setup([]);
    expect(
      getByText("Ingen svarmuligheder endnu — tilføj den første nedenfor."),
    ).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("viser svarmulighederne i den givne rækkefølge", () => {
    const { container } = setup([
      option("a", "Alfa"),
      option("b", "Beta"),
      option("c", "Gamma"),
    ]);
    expect(labelsInOrder(container)).toEqual(["Alfa", "Beta", "Gamma"]);
  });

  it("viser tag-picker kun for kind=tag og markerer koblede tags", () => {
    const { container } = setup([
      option("a", "Alfa", { competenceTagIds: ["t2"] }),
      option("b", "Beta", { kind: "free_text" }),
    ]);
    const items = listItems(container);
    const alfa = at(items, 0);
    const beta = at(items, 1);

    const alfaBoxes =
      alfa.querySelectorAll<HTMLInputElement>('input[name="tag"]');
    expect(alfaBoxes).toHaveLength(2);
    expect(Array.from(alfaBoxes).map((b) => b.checked)).toEqual([false, true]);
    expect(beta.querySelector('input[name="tag"]')).toBeNull();
  });

  it("sender ingen inline-styles i hele listen (kun token-klasser)", () => {
    const { container } = setup([
      option("a", "Alfa", { competenceTagIds: ["t1"] }),
      option("b", "Beta"),
    ]);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    for (const li of listItems(container)) {
      expect(li.className).toBe("option-item");
    }
    expect(container.querySelector("ul")?.className).toBe("stack");
  });
});

describe("OptionsSection — drag-omordning", () => {
  it("flytter en svarmulighed med drag-events og persisterer den nye rækkefølge ved drop", async () => {
    const { container, reorderOptions } = setup([
      option("a", "Alfa"),
      option("b", "Beta"),
      option("c", "Gamma"),
    ]);
    const handles = Array.from(container.querySelectorAll(".drag-handle"));
    const items = listItems(container);

    // Træk Alfa (index 0) forbi Beta (index 1) og ned til Gamma (index 2).
    fireEvent.dragStart(at(handles, 0));
    fireEvent.dragOver(at(items, 1));
    fireEvent.dragOver(at(items, 2));

    expect(labelsInOrder(container)).toEqual(["Beta", "Gamma", "Alfa"]);
    expect(reorderOptions).not.toHaveBeenCalled();

    fireEvent.drop(at(items, 2));

    await waitFor(() => expect(reorderOptions).toHaveBeenCalledTimes(1));
    const formData = submittedFormData(reorderOptions);
    expect(formData.get("question_id")).toBe("q1");
    expect(formData.get("order")).toBe("b,c,a");
  });

  it("ændrer ingen rækkefølge når der trækkes over samme element", () => {
    const { container } = setup([option("a", "Alfa"), option("b", "Beta")]);
    const handles = Array.from(container.querySelectorAll(".drag-handle"));
    const items = listItems(container);

    fireEvent.dragStart(at(handles, 0));
    fireEvent.dragOver(at(items, 0));

    expect(labelsInOrder(container)).toEqual(["Alfa", "Beta"]);
  });

  it("ignorerer dragOver uden et igangværende træk", () => {
    const { container } = setup([option("a", "Alfa"), option("b", "Beta")]);
    fireEvent.dragOver(at(listItems(container), 1));
    expect(labelsInOrder(container)).toEqual(["Alfa", "Beta"]);
  });

  it("persisterer den uændrede rækkefølge når et træk slipper samme sted", async () => {
    const { container, reorderOptions } = setup([
      option("a", "Alfa"),
      option("b", "Beta"),
    ]);
    const items = listItems(container);
    fireEvent.dragStart(
      at(Array.from(container.querySelectorAll(".drag-handle")), 0),
    );
    fireEvent.drop(at(items, 0));

    await waitFor(() => expect(reorderOptions).toHaveBeenCalledTimes(1));
    expect(submittedFormData(reorderOptions).get("order")).toBe("a,b");
  });
});

describe("OptionsSection — fejlhåndtering", () => {
  it("viser den gemte rækkefølge igen og en fejlbesked når reorderOptions afviser", async () => {
    const reorderOptions = vi.fn(async () => {
      throw new Error("db nede");
    });
    const { container, findByRole } = setup(
      [option("a", "Alfa"), option("b", "Beta"), option("c", "Gamma")],
      reorderOptions,
    );
    const items = listItems(container);
    fireEvent.dragStart(
      at(Array.from(container.querySelectorAll(".drag-handle")), 0),
    );
    fireEvent.dragOver(at(items, 1));
    expect(labelsInOrder(container)).toEqual(["Beta", "Alfa", "Gamma"]);

    fireEvent.drop(at(items, 1));

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("Rækkefølgen kunne ikke gemmes");
    expect(alert.className).toBe("form__notice");
    expect(labelsInOrder(container)).toEqual(["Alfa", "Beta", "Gamma"]);
  });

  it("viser ingen fejlbesked når gemningen lykkes", async () => {
    const { container, reorderOptions, queryByRole } = setup([
      option("a", "Alfa"),
      option("b", "Beta"),
    ]);
    fireEvent.dragStart(
      at(Array.from(container.querySelectorAll(".drag-handle")), 0),
    );
    fireEvent.dragOver(at(listItems(container), 1));
    fireEvent.drop(at(listItems(container), 1));

    await waitFor(() => expect(reorderOptions).toHaveBeenCalledTimes(1));
    expect(queryByRole("alert")).toBeNull();
  });
});
