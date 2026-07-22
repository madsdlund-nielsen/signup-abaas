import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { Checkbox } from "@/components/Checkbox";

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

describe("Checkbox (kun tokens via klasser)", () => {
  it("labeler checkbox via unikt id, token-klasser, ingen inline-style", () => {
    const { getByLabelText } = render(
      <Checkbox name="tag" value="t1" label="Salg og marketing" defaultChecked />,
    );
    const input = getByLabelText("Salg og marketing") as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.id).toBe("tag-t1");
    expect(input.name).toBe("tag");
    expect(input.value).toBe("t1");
    expect(input.checked).toBe(true);
    expect(input.className).toBe("checkbox__input");
    expect(input.getAttribute("style")).toBeNull();
  });

  it("to checkboxes med samme name får unikke id'er via value", () => {
    const { getByLabelText } = render(
      <div>
        <Checkbox name="tag" value="a" label="Alpha" />
        <Checkbox name="tag" value="b" label="Beta" />
      </div>,
    );
    expect((getByLabelText("Alpha") as HTMLInputElement).id).toBe("tag-a");
    expect((getByLabelText("Beta") as HTMLInputElement).id).toBe("tag-b");
  });
});
