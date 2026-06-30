import type { ReactNode } from "react";

/** Versal guld-eyebrow med letter-spacing. Kun tokens (.eyebrow). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}
