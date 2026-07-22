import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth";
import { signOutAction } from "@/server/auth/actions";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Dashboard — Advisory Board Unlimited" };

// Afhænger af session/cookies — aldrig statisk prerender.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="container stack">
      <p className="eyebrow">Advisory Board Unlimited</p>
      <h1 className="heading-2 heading--on-light">Velkommen</h1>
      <p className="body">
        Logget ind som <strong>{user.email}</strong>.
      </p>
      <p className="body">
        Roller: {user.roles.length > 0 ? user.roles.join(", ") : "ingen tildelt endnu"}.
      </p>
      {user.roles.includes("ejer") ? (
        <p className="body">
          <Link className="btn-secondary" href="/onboarding">
            Start onboarding
          </Link>
        </p>
      ) : null}
      <form action={signOutAction}>
        <PrimaryButton type="submit">Log ud</PrimaryButton>
      </form>
    </main>
  );
}
