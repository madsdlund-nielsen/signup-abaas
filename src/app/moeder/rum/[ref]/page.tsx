import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";
import { getCurrentUser } from "@/server/auth";
import { getMeeting, getMeetingByBookingUid, type Meeting } from "@/server/meetings";

export const metadata: Metadata = { title: "Møderum — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL: Record<Meeting["status"], string> = {
  planlagt: "Planlagt",
  aflyst: "Aflyst",
  afholdt: "Afholdt",
};

function formatStart(startsAt: string): string {
  return new Date(startsAt).toLocaleString("da-DK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

/**
 * Demo-møderummet (ADR 0041). Står i stedet for Cal Video-linket når booking kører i
 * demo-tilstand: "Deltag" skal lande på en side man kan se og designe på, ikke i en 404.
 * Når Cal Video er konfigureret, peger `video_join_url` på leverandøren i stedet, og denne
 * side nås ikke længere fra noget link.
 *
 * `ref` er enten booking-uid'et (booking-demoen) eller mødets id (video-demoen) — begge
 * demo-adaptere peger herhen. Læsningen er RLS-scopet som alle andre mødesider: et fremmed
 * og et ukendt møde ser ens ud udefra.
 */
export default async function DemoMeetingRoomPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { ref } = await params;
  const meeting = UUID.test(ref) ? await getMeeting(ref) : await getMeetingByBookingUid(ref);
  if (!meeting) notFound();

  const backHref = user.roles.includes("ejer")
    ? "/moeder"
    : user.roles.includes("partner")
      ? "/partner"
      : "/dashboard";
  const backLabel = backHref === "/moeder" ? "Møder" : backHref === "/partner" ? "Partnerportal" : "Dashboard";

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href={backHref}>{backLabel}</Link> · Møderum
          </>
        }
        title={formatStart(meeting.startsAt)}
        lead={
          <>
            {STATUS_LABEL[meeting.status]} · {meeting.durationMinutes} minutters møde ·{" "}
            {meeting.participants.map((p) => p.name).join(", ") || "ingen partnere"}
          </>
        }
      />
      <PageBody>
        <section className="panel stack measure">
          <p className="eyebrow">Demo-møderum</p>
          <h2 className="heading-3 heading--on-light">Her ville videomødet være</h2>
          <p className="body">
            I demo-tilstand er møderummet en side i appen. Når Cal Video er sat op, sender
            &ldquo;Deltag&rdquo; i stedet direkte til det rigtige videomøde med alle deltagere — og
            denne side nås ikke længere.
          </p>
          {meeting.participants.length > 0 ? (
            <ul className="stack">
              {meeting.participants.map((p) => (
                <li key={p.partnerProfileId} className="body">
                  {p.name}
                </li>
              ))}
            </ul>
          ) : null}
          <span className="row-form">
            <Link className="btn-secondary" href={`/moeder/${meeting.id}`}>
              Forberedelse og dagsorden
            </Link>
            <Link className="btn-secondary" href={backHref}>
              Tilbage til {backLabel.toLowerCase()}
            </Link>
          </span>
        </section>
      </PageBody>
    </>
  );
}
