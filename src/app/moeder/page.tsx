import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { getCurrentUser } from "@/server/auth";
import { getMyBoard } from "@/server/boards";
import { listMyMeetings, type Meeting } from "@/server/meetings";
import { bookMeeting, cancelMeeting, rescheduleMeeting } from "@/server/meetings/actions";

export const metadata: Metadata = { title: "Møder — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

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

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");

  const [board, meetings] = await Promise.all([getMyBoard(), listMyMeetings()]);

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/dashboard">Dashboard</Link> · Møder
      </p>
      <h1 className="heading-2 heading--on-light">Dine board-møder</h1>
      <p className="body">
        Hvert møde varer 60 minutter, og dine partnere har 15 minutters betalt forberedelse
        inden. Booking tjekker alle valgte partneres kalendere.
      </p>

      {!board ? (
        <p className="body">
          Du har ikke godkendt et board endnu.{" "}
          <Link className="btn-secondary" href="/board">
            Se dit anbefalede board
          </Link>
        </p>
      ) : (
        <section className="stack measure">
          <h2 className="heading-3 heading--on-light">Book et møde</h2>
          <AuthForm action={bookMeeting} submitLabel="Book møde">
            <input type="hidden" name="board_id" value={board.id} />
            <Field name="starts_at" label="Starttidspunkt" type="datetime-local" required />
          </AuthForm>
        </section>
      )}

      {meetings.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Tidspunkt</th>
              <th className="table__head">Status</th>
              <th className="table__head">Deltagere</th>
              <th className="table__head">Video</th>
              <th className="table__head">Handling</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((meeting) => (
              <tr key={meeting.id} className="table__row">
                <td className="table__cell">
                  <Link href={`/moeder/${meeting.id}`}>{formatStart(meeting.startsAt)}</Link>
                </td>
                <td className="table__cell">{STATUS_LABEL[meeting.status]}</td>
                <td className="table__cell">
                  {meeting.participants.map((p) => p.name).join(", ") || "—"}
                </td>
                <td className="table__cell">
                  {meeting.videoJoinUrl ? (
                    <a href={meeting.videoJoinUrl}>Deltag</a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="table__cell">
                  {meeting.status === "planlagt" ? (
                    <span className="row-form">
                      <AuthForm action={rescheduleMeeting} submitLabel="Flyt">
                        <input type="hidden" name="meeting_id" value={meeting.id} />
                        <Field name="starts_at" label="Nyt tidspunkt" type="datetime-local" required />
                      </AuthForm>
                      <AuthForm action={cancelMeeting} submitLabel="Aflys">
                        <input type="hidden" name="meeting_id" value={meeting.id} />
                      </AuthForm>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="body">Ingen møder endnu.</p>
      )}
    </main>
  );
}
