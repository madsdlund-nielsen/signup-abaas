import type { TextareaHTMLAttributes } from "react";

interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className"> {
  name: string;
  label: string;
}

/**
 * Labelet flerlinjefelt. Styling udelukkende via token-klasser (.field*) — ingen inline-styles.
 */
export function TextArea({ name, label, ...rest }: TextAreaProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={name}>
        {label}
      </label>
      <textarea className="field__textarea" id={name} name={name} {...rest} />
    </div>
  );
}
