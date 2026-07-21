import type { InputHTMLAttributes } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  /** Felt-id + name; label knyttes via htmlFor. */
  name: string;
  label: string;
}

/**
 * Labelet inputfelt. Al styling kommer fra token-klasser (.field*) i components.css —
 * ingen inline-styles, farver, radius eller spacing hardcodet.
 */
export function Field({ name, label, type = "text", ...rest }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={name}>
        {label}
      </label>
      <input className="field__input" id={name} name={name} type={type} {...rest} />
    </div>
  );
}
