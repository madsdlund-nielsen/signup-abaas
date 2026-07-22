import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";

describe("Select (kun tokens via klasser)", () => {
  it("labeler select via htmlFor/id, token-klasse, ingen inline-style", () => {
    const { getByLabelText } = render(
      <Select name="kind" label="Type" defaultValue="multi">
        <option value="single">Enkelt</option>
        <option value="multi">Multi</option>
      </Select>,
    );
    const select = getByLabelText("Type") as HTMLSelectElement;
    expect(select.id).toBe("kind");
    expect(select.name).toBe("kind");
    expect(select.className).toBe("field__select");
    expect(select.getAttribute("style")).toBeNull();
    expect(select.value).toBe("multi");
  });
});

describe("TextArea (kun tokens via klasser)", () => {
  it("labeler textarea via htmlFor/id, token-klasse, ingen inline-style", () => {
    const { getByLabelText } = render(<TextArea name="prompt" label="Tekst" defaultValue="hej" />);
    const ta = getByLabelText("Tekst") as HTMLTextAreaElement;
    expect(ta.id).toBe("prompt");
    expect(ta.name).toBe("prompt");
    expect(ta.className).toBe("field__textarea");
    expect(ta.getAttribute("style")).toBeNull();
    expect(ta.value).toBe("hej");
  });
});
