import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Field } from "@/components/Field";
import { AuthForm } from "@/components/AuthForm";

describe("Field (kun tokens via klasser)", () => {
  it("labeler input via htmlFor/id og bruger token-klasser uden inline-style", () => {
    const { getByLabelText, container } = render(<Field name="email" label="E-mail" type="email" />);
    const input = getByLabelText("E-mail") as HTMLInputElement;
    expect(input.id).toBe("email");
    expect(input.name).toBe("email");
    expect(input.type).toBe("email");
    expect(input.className).toBe("field__input");
    expect(input.getAttribute("style")).toBeNull();
    expect(container.querySelector("label")?.className).toBe("field__label");
  });

  it("videresender attributter (required, autoComplete)", () => {
    const { getByLabelText } = render(
      <Field name="password" label="Adgangskode" type="password" required autoComplete="current-password" />,
    );
    const input = getByLabelText("Adgangskode") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("current-password");
  });
});

describe("AuthForm-skal", () => {
  const noop: AuthFormActionType = async () => ({});

  it("renderer felter + submit-label uden fejlnotits ved start", () => {
    const { getByRole, queryByRole } = render(
      <AuthForm action={noop} submitLabel="Log ind">
        <Field name="email" label="E-mail" type="email" />
      </AuthForm>,
    );
    expect(getByRole("button", { name: "Log ind" })).toBeTruthy();
    expect(getByRole("textbox", { name: "E-mail" })).toBeTruthy();
    // Fejlnotitsen (role=alert) vises kun når action returnerer { error }.
    expect(queryByRole("alert")).toBeNull();
  });
});

// Lokal type-alias for at holde testen selvforklarende.
type AuthFormActionType = (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
