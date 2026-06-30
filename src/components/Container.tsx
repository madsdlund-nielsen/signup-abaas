import type { ReactNode } from "react";

/** Centreret indholdsbredde med ydre gutters. Kun tokens (.container-x). */
export function Container({ children }: { children: ReactNode }) {
  return <div className="container-x">{children}</div>;
}
