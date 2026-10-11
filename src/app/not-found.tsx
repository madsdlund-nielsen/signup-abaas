import Link from "next/link";
import type { Metadata } from "next";

import { ErrorPage } from "@/components/ErrorPage";

export const metadata: Metadata = { title: "Siden findes ikke — Advisory Board Unlimited" };

/**
 * 404 (fase 6.2, ADR 0070). Rendres inde i rodlayoutet, så header og fod står som på alle
 * andre sider. Roligt og uden skyld: adressen kan være ændret eller tastet forkert.
 */
export default function NotFound() {
  return (
    <ErrorPage
      eyebrow="404"
      title="Siden findes ikke."
      actions={
        <Link className="btn-primary" href="/">
          Til forsiden
        </Link>
      }
    >
      Linket kan være ændret, eller adressen er tastet forkert. Gå tilbage til forsiden og find vej
      derfra.
    </ErrorPage>
  );
}
