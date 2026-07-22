import type { ReactNode, SelectHTMLAttributes } from "react";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> {
  name: string;
  label: string;
  children: ReactNode;
}

/**
 * Labelet dropdown. Styling udelukkende via token-klasser (.field*) — ingen inline-styles.
 */
export function Select({ name, label, children, ...rest }: SelectProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={name}>
        {label}
      </label>
      <select className="field__select" id={name} name={name} {...rest}>
        {children}
      </select>
    </div>
  );
}
