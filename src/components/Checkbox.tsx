import type { InputHTMLAttributes } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type"> {
  name: string;
  label: string;
  value: string;
}

/**
 * Labelet afkrydsningsfelt til checkbox-grupper (fx tag-picker). Al styling via token-klasser
 * (.checkbox*) — ingen inline-styles, farver eller spacing hardcodet. Accentfarve = guld-token.
 */
export function Checkbox({ name, label, value, ...rest }: CheckboxProps) {
  const id = `${name}-${value}`;
  return (
    <label className="checkbox" htmlFor={id}>
      <input className="checkbox__input" id={id} name={name} type="checkbox" value={value} {...rest} />
      <span className="checkbox__label">{label}</span>
    </label>
  );
}
