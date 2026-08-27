import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { TextArea } from "@/components/TextArea";
import { PrimaryButton } from "@/components/PrimaryButton";
import { getCurrentUser } from "@/server/auth";
import { getMyBoard } from "@/server/boards";
import { listMyMeetings, type Meeting } from "@/server/meetings";
import { initiateNextMeeting, registerMeetingStatus, saveMeetingNote } from "@/server/meetings/actions";
import { getMyPartnerProfile } from "@/server/partners/portal";
import { updateMyPartnerProfile } from "@/server/partners/self-actions";
import { listTags } from "@/server/tags";

export const metadata: Metadata = { title: "Partner — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Meeting["status"], string> = {
  planlagt: "Planlagt",
  aflyst: "Aflyst",
  afholdt: "Afholdt",
};

const REGISTERED_LABEL: Record<string, string> = {
  afholdt: "Afholdt",
  forsinket_afbud: "Forsinket afbud",
  udeblivelse: "Udeblivelse",
};

function formatStart(startsAt: string): string {
  return new Date(startsAt).toLocaleString("da-DK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

export default async function PartnerPortalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("partner")) redirect("/dashboard");

  const [profile, board, meetings, tags] = await Promise.all([
    getMyPartnerProfile(),
    getMyBoard(),
    listMyMeetings(),
    listTags(),
  ]);
  const tagLabels = new Map(tags.map((tag) => [tag.id, tag.label]));
  const isLead = Boolean(
    profile && board?.members.some((member) => member.partnerId === profile.id && member.isLead),
  );

  return (
    <main className="container stack">
      <p className="eyebrow">Advisory Board Unlimited · Partner</p>
      <h1 className="heading-2 heading--on-light">Din partnerportal</h1>

      {!profile ? (
        <p className="form__notice" role="status">
          Din bruger er endnu ikke koblet til en katalogprofil. Kontakt administratoren.
        </p>
      ) : (
        <>
          <section className="stack measure">
            <h2 className="heading-3 heading--on-light">Din profil</h2>
            <p className="body">
              Du kan redigere din profil-info her. Kompetence-tags styres af administratoren og
              kan ikke ændres.
            </p>
            {profile.competenceTagIds.length > 0 ? (
              <ul className="partner-card__tags">
                {profile.competenceTagIds.map((tagId) => (
                  <li key={tagId} className="partner-tag">
                    {tagLabels.get(tagId) ?? "Ukendt kompetence"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="body">Ingen kompetence-tags tildelt endnu.</p>
            )}
            <form className="form" action={updateMyPartnerProfile}>
              <Field name="name" label="Navn" defaultValue={profile.name} required />
              <Field name="title" label="Titel/rolle" defaultValue={profile.title ?? undefined} />
              <Field name="languages" label="Sprog" defaultValue={profile.languages ?? undefined} />
              <Field name="photo_url" label="Billede-URL" defaultValue={profile.photoUrl ?? undefined} />
              <TextArea
                name="personal_info"
                label="Personlig info"
                defaultValue={profile.personalInfo ?? undefined}
              />
              <TextArea name="short_bio" label="Kort bio" defaultValue={profile.shortBio ?? undefined} />
              <TextArea name="long_bio" label="Lang bio" defaultValue={profile.longBio ?? undefined} />
              <PrimaryButton type="submit">Gem profil</PrimaryButton>
            </form>
          </section>

          <section className="stack">
            <h2 className="heading-3 heading--on-light">Dit board</h2>
            {board ? (
              <p className="body">
                {board.name}: {board.members.map((member) => member.name).join(", ")}.
              </p>
            ) : (
              <p className="body">Du sidder ikke på et board endnu.</p>
            )}
            {isLead && board ? (
              <div className="measure stack">
                <p className="body">
                  Som lead-partner har du ansvar for at sikre aftale om næste møde.
                </p>
                <AuthForm action={initiateNextMeeting} submitLabel="Initiér næste møde">
                  <input type="hidden" name="board_id" value={board.id} />
                  <Field name="starts_at" label="Starttidspunkt" type="datetime-local" required />
                </AuthForm>
              </div>
            ) : null}
          </section>

          <section className="stack">
            <h2 className="heading-3 heading--on-light">Dine møder</h2>
            {meetings.length === 0 ? <p className="body">Ingen møder endnu.</p> : null}
            {meetings.map((meeting) => {
              const mine = meeting.participants.find((p) => p.partnerProfileId === profile.id);
              return (
                <article key={meeting.id} className="stack measure">
                  <h3 className="heading-3 heading--on-light">
                    <Link href={`/moeder/${meeting.id}`}>{formatStart(meeting.startsAt)}</Link>
                  </h3>
                  <p className="body">
                    Status: {STATUS_LABEL[meeting.status]}
                    {" · "}
                    <Link href={`/moeder/${meeting.id}`}>
                      {meeting.status === "afholdt" ? "Forberedelse og vurdering" : "Forberedelse"}
                    </Link>
                    {meeting.videoJoinUrl ? (
                      <>
                        {" · "}
                        <a href={meeting.videoJoinUrl}>Deltag i videomødet</a>
                      </>
                    ) : null}
                  </p>
                  {mine?.registeredStatus ? (
                    <p className="body">
                      Din registrering: {REGISTERED_LABEL[mine.registeredStatus]}.
                    </p>
                  ) : meeting.status !== "aflyst" ? (
                    <form className="row-form" action={registerMeetingStatus}>
                      <input type="hidden" name="meeting_id" value={meeting.id} />
                      <button className="btn-secondary" type="submit" name="registered_status" value="afholdt">
                        Afholdt
                      </button>
                      <button
                        className="btn-secondary"
                        type="submit"
                        name="registered_status"
                        value="forsinket_afbud"
                      >
                        Forsinket afbud
                      </button>
                      <button
                        className="btn-secondary"
                        type="submit"
                        name="registered_status"
                        value="udeblivelse"
                      >
                        Udeblivelse
                      </button>
                    </form>
                  ) : null}
                  {meeting.status === "afholdt" ? (
                    <form className="form" action={saveMeetingNote}>
                      <input type="hidden" name="meeting_id" value={meeting.id} />
                      <TextArea name="body" label="Din møde-note (efter møde)" required />
                      <PrimaryButton type="submit">Gem note</PrimaryButton>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </section>
        </>
      )}

      <p className="body">
        <Link href="/dashboard">Til dashboard</Link>
      </p>
    </main>
  );
}
