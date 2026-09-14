import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { createPaymentProvider } from "@/lib/payments";
import { getCurrentUser } from "@/server/auth";
import { getMyMembership } from "@/server/memberships";
import { confirmDemoCard } from "@/server/memberships/actions";

export const metadata: Metadata = { title: "Kortregistrering — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

/**
 * Demo-checkouten (ADR 0041). Står i stedet for leverandørens hostede kortregistrering når
 * betaling kører i demo-tilstand. Der findes ingen kortfelter — intet må ligne noget man kan
 * taste et rigtigt kort ind i. Ét klik gør det webhooken ellers gør (`confirmDemoCard`).
 *
 * Findes kun mens demo-provideren er den aktive: er Alunta konfigureret, er siden en 404 —
 * samme regel som `confirmDemoCard` håndhæver på skrivesiden.
 */
export default async function DemoCardPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");
  if (createPaymentProvider().name !== "demo") notFound();

  const { membershipId } = await params;
  const membership = await getMyMembership();
  // Kun eget medlemskab: et fremmed id ser ud som et ukendt.
  if (!membership || membership.id !== membershipId) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/betaling">Abonnement</Link> · Kortregistrering
          </>
        }
        title="Demo-kortregistrering"
        lead="Her ville betalingsleverandørens sikre side være. I demo-tilstand bekræfter du med ét klik — der registreres intet rigtigt kort, og der trækkes aldrig penge."
      />
      <PageBody>
        <section className="panel stack measure">
          <p className="eyebrow">Demo</p>
          {membership.cardStatus === "registreret" ? (
            <>
              <p className="body">Demo-kortet er allerede registreret på dit medlemskab.</p>
              <Link className="btn-secondary" href="/betaling">
                Tilbage til abonnement
              </Link>
            </>
          ) : (
            <>
              <table className="table">
                <tbody>
                  <tr className="table__row">
                    <th className="table__head">Kort</th>
                    <td className="table__cell">Demo-kort •••• 0000</td>
                  </tr>
                  <tr className="table__row">
                    <th className="table__head">Udløb</th>
                    <td className="table__cell">00/00</td>
                  </tr>
                  <tr className="table__row">
                    <th className="table__head">Kortholder</th>
                    <td className="table__cell">Ejer Testesen</td>
                  </tr>
                </tbody>
              </table>
              <AuthForm action={confirmDemoCard} submitLabel="Bekræft demo-kort">
                <input type="hidden" name="membership_id" value={membership.id} />
              </AuthForm>
              <Link href="/betaling">Annullér — tilbage til abonnement</Link>
            </>
          )}
        </section>
      </PageBody>
    </>
  );
}
