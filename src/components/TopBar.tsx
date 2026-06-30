import type { ReactNode } from "react";

/** Tynd kontaktbar øverst (navy). Versal-UI. Kun tokens. */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="topbar">
      <div className="topbar__inner">{children}</div>
    </div>
  );
}
