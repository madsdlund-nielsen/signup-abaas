import type { ButtonHTMLAttributes, ReactNode } from "react";

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * Kanon-CTA. Al styling kommer fra `.btn-primary` i design-tokens.css —
 * komponenten hardcoder hverken farve, font, radius eller spacing.
 */
export function PrimaryButton({ children, type = "button", ...rest }: PrimaryButtonProps) {
  return (
    <button className="btn-primary" type={type} {...rest}>
      {children}
    </button>
  );
}
