import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PrimaryButton } from "@/components/PrimaryButton";

describe("PrimaryButton (kanon-CTA)", () => {
  it("renderer som .btn-primary uden inline-styles (kun tokens via CSS-klasse)", () => {
    const { getByRole } = render(<PrimaryButton>Kom i gang</PrimaryButton>);
    const button = getByRole("button", { name: "Kom i gang" });
    expect(button.className).toBe("btn-primary");
    expect(button.getAttribute("style")).toBeNull();
  });
});
