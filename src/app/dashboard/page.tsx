import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { getCurrentUser } from "@/server/auth";
import { signOutAction } from "@/server/auth/actions";

export const metadata: Metadata = {
  title: "Dashboard — Advisory Board Unlimited",
};

// Afhænger af session/cookies — aldrig statisk prerender.
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ejer: "Ejer",
  partner: "Partner",
  lead_partner: "Lead-partner",
  admin: "Administrator",
};

/** Ét indgangspanel. Titel, én sætning om hvad man kan derinde, og ét link. */
function EntryPanel({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="panel">
      <h2 className="heading-3 heading--on-light">{title}</h2>
      <p className="body">{body}</p>
      <Link className="btn-secondary" href={href}>
        {cta}
      </Link>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roles = user.roles.map((r) => ROLE_LABEL[r] ?? r);

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Velkommen"
        lead={
          <>
            Du er logget ind som {user.email}
            {roles.length > 0 ? ` · ${roles.join(", ")}` : ""}.
          </>
        }
      />
      <PageBody>
        {user.roles.length === 0 ? (
          <p className="empty">
            Din konto har endnu ingen rolle tildelt, så der er ikke noget at gå til herfra. Roller
            tildeles af en administrator — det er med vilje, så ingen kan give sig selv adgang ved
            at oprette en konto.
          </p>
        ) : null}

        {user.roles.includes("ejer") ? (
          <div className="panel-grid">
            <EntryPanel
              title="Onboarding"
              body="Besvar quizzen, så vi kan oversætte dine udfordringer til de kompetencer dit board skal dække."
              href="/onboarding"
              cta="Start onboarding"
            />
            <EntryPanel
              title="Dit board"
              body="Se hvilke rådgivere vi har sammensat til dig, og hvorfor hver enkelt er valgt."
              href="/board"
              cta="Se board"
            />
            <EntryPanel
              title="Møder"
              body="Book, flyt eller aflys møder — og forbered dagsordenen inden I mødes."
              href="/moeder"
              cta="Gå til møder"
            />
            <EntryPanel
              title="Abonnement"
              body="Din betaling og dit abonnements omfang."
              href="/betaling"
              cta="Se abonnement"
            />
          </div>
        ) : null}

        {user.roles.includes("partner") ? (
          <div className="panel-grid">
            <EntryPanel
              title="Partnerportalen"
              body="Din profil, dine møder, og forberedelsen til dem."
              href="/partner"
              cta="Gå til portalen"
            />
          </div>
        ) : null}

        {user.roles.includes("admin") ? (
          <div className="panel-grid">
            <EntryPanel
              title="Administration"
              body="Quiz, kompetence-tags, partnerkatalog, prisregler og vurderinger."
              href="/admin"
              cta="Gå til admin"
            />
          </div>
        ) : null}

        <div className="section-rule">
          <form action={signOutAction}>
            <PrimaryButton type="submit">Log ud</PrimaryButton>
          </form>
        </div>
      </PageBody>
    </>
  );
}
