"use client";

import { CONSENT_OPEN_EVENT } from "@/server/consent";

/**
 * Footerlinket der genåbner cookie-banneret (ADR 0072). En knap, ikke et link: den navigerer
 * ikke, den åbner en dialog-lignende region. Renderes kun når banneret findes.
 */
export function CookieSettingsLink() {
  return (
    <button
      className="sitefooter__link"
      type="button"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      Cookie-indstillinger
    </button>
  );
}
