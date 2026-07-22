import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/server/auth";

// Afhænger af session/rolle — aldrig statisk prerender.
export const dynamic = "force-dynamic";

/**
 * Rolle-guard for hele /admin (Fase 1-fundament, ADR 0016). Ikke logget ind → /login;
 * logget ind uden admin-rolle → /dashboard. Mønster for al fremtidig admin-overflade.
 * RLS + service-role-actions er andet lag (defense-in-depth) — guarden er ikke eneste værn.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("admin")) redirect("/dashboard");
  return <>{children}</>;
}
