import type { ReactNode } from "react";

/**
 * Tynd kontaktbar øverst (navy). Versal-UI. Kun tokens. Et navngivet område, så den ikke står
 * som indhold uden for alle landmarks (axe-reglen `region`, ADR 0070).
 */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="topbar" role="region" aria-label="Kontaktoplysninger">
      <div className="topbar__inner">{children}</div>
    </div>
  );
}
