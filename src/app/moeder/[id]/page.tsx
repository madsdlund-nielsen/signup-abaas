import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";

import { AuthForm } from "@/components/AuthForm";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { getCurrentUser } from "@/server/auth";
import { getMeeting, type Meeting } from "@/server/meetings";
import { getMyPartnerProfile } from "@/server/partners/portal";
import {
  AGENDA_KIND_LABEL,
  getMyPrepNote,
  listAgendaItems,
  type AgendaItemKind,
} from "@/server/preparation";
import { addAgendaItem, deleteAgendaItem, savePrepNote } from "@/server/preparation/actions";
import { listMyRatingsForMeeting, RATING_MAX, RATING_MIN } from "@/server/ratings";
import { submitRating } from "@/server/ratings/actions";

export const metadata: Metadata = {
  title: "Forberedelse — Advisory Board Unlimited",
};
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Meeting["status"], string> = {
  planlagt: "Planlagt",
  aflyst: "Aflyst",
  afholdt: "Afholdt",
};

const KIND_ORDER: readonly AgendaItemKind[] = ["dagsorden", "spoergsmaal", "materiale"];

const SCORE_OPTIONS = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

function formatStart(startsAt: string): string {
  return new Date(startsAt).toLocaleString("da-DK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

/**
 * Forberedelsesrummet for ét møde (fase 4.1) plus vurdering efter afholdelse (4.2).
 *
 * Ét sted for begge roller. RLS scoper allerede hvad ejer og partner må se, så siden
 * forgrener kun på hvad man må SKRIVE: ejeren redigerer dagsordenen, den deltagende
 * partner skriver sin egen forberedelse. Læsedelen er den samme kode for begge.
 */
export default async function MeetingPreparationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const meeting = await getMeeting(id);
  // Findes ikke, eller RLS gav 0 rækker. De to ser ens ud udefra — med vilje.
  if (!meeting) notFound();

  const isOwner = user.roles.includes("ejer");
  const profile = user.roles.includes("partner") ? await getMyPartnerProfile() : null;
  const myParticipation = profile
    ? meeting.participants.find((p) => p.partnerProfileId === profile.id)
    : undefined;

  const [agenda, prepNote, myRatings] = await Promise.all([
    listAgendaItems(meeting.id),
    myParticipation ? getMyPrepNote(meeting.id) : Promise.resolve(null),
    meeting.status === "afholdt" ? listMyRatingsForMeeting(meeting.id) : Promise.resolve([]),
  ]);

  const ratedSubjects = new Set(myRatings.map((r) => r.subjectPartnerProfileId));
  const canRate = meeting.status === "afholdt" && (isOwner || Boolean(myParticipation));
  const backHref = myParticipation && !isOwner ? "/partner" : "/moeder";

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href={backHref}>{backHref === "/partner" ? "Partnerportal" : "Møder"}</Link> ·
            Forberedelse
          </>
        }
        title={formatStart(meeting.startsAt)}
        lead={
          <>
            {STATUS_LABEL[meeting.status]} · {meeting.durationMinutes} minutters møde ·{" "}
            {meeting.prepMinutes} minutters betalt forberedelse ·{" "}
            {meeting.participants.map((p) => p.name).join(", ") || "ingen partnere"}
          </>
        }
      />
      <PageBody>
        {/* --- Dagsorden: delt. Ejeren redigerer, partneren læser. --- */}
        <section className="stack measure">
          <h2 className="heading-3 heading--on-light">Dagsorden og spørgsmål</h2>
          {agenda.length > 0 ? (
            KIND_ORDER.filter((kind) => agenda.some((item) => item.kind === kind)).map((kind) => (
              <div key={kind} className="stack">
                <p className="eyebrow">{AGENDA_KIND_LABEL[kind]}</p>
                <ul className="stack">
                  {agenda
                    .filter((item) => item.kind === kind)
                    .map((item) => (
                      <li key={item.id} className="option-item">
                        <span className="row-form">
                          <span className="body">{item.body}</span>
                          {isOwner ? (
                            <AuthForm action={deleteAgendaItem} submitLabel="Fjern">
                              <input type="hidden" name="item_id" value={item.id} />
                            </AuthForm>
                          ) : null}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="body">
              {isOwner
                ? "Du har ikke skrevet noget til dette møde endnu."
                : "Ejeren har ikke lagt en dagsorden op endnu."}
            </p>
          )}

          {isOwner && meeting.status === "planlagt" ? (
            <AuthForm action={addAgendaItem} submitLabel="Tilføj">
              <input type="hidden" name="meeting_id" value={meeting.id} />
              <Select name="kind" label="Type" defaultValue="dagsorden" required>
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {AGENDA_KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
              <TextArea name="body" label="Indhold" rows={3} required />
            </AuthForm>
          ) : null}
        </section>

        {/* --- Partnerens eget forberedelsesrum: privat. --- */}
        {myParticipation ? (
          <section className="stack measure">
            <h2 className="heading-3 heading--on-light">Din forberedelse</h2>
            <p className="body">
              Dine {meeting.prepMinutes} betalte forberedelsesminutter. Kun du og administrator kan
              se denne tekst — ejeren kan ikke.
            </p>
            <AuthForm action={savePrepNote} submitLabel="Gem forberedelse">
              <input type="hidden" name="meeting_id" value={meeting.id} />
              <TextArea
                name="body"
                label="Noter til dig selv"
                rows={6}
                defaultValue={prepNote?.body ?? ""}
                required
              />
            </AuthForm>
          </section>
        ) : null}

        {/* --- Vurdering: kun efter afholdelse. --- */}
        {canRate ? (
          <section className="stack measure">
            <h2 className="heading-3 heading--on-light">Vurder mødet</h2>
            <p className="body">
              Vurderinger er fortrolige: kun du og administrator kan se dem. De bruges ikke
              automatisk til noget endnu.
            </p>

            <AuthForm action={submitRating} submitLabel="Gem vurdering">
              <input type="hidden" name="meeting_id" value={meeting.id} />
              <Select name="score" label="Mødet samlet set" defaultValue="" required>
                <option value="" disabled>
                  Vælg
                </option>
                {SCORE_OPTIONS.map((score) => (
                  <option key={score} value={score}>
                    {score}
                  </option>
                ))}
              </Select>
              <TextArea name="comment" label="Kommentar (valgfri)" rows={2} />
            </AuthForm>

            {isOwner && meeting.participants.length > 0 ? (
              <div className="stack">
                <p className="eyebrow">Vurder den enkelte rådgiver</p>
                {meeting.participants.map((participant) => (
                  <AuthForm
                    key={participant.partnerProfileId}
                    action={submitRating}
                    submitLabel={
                      ratedSubjects.has(participant.partnerProfileId)
                        ? `Opdatér ${participant.name}`
                        : `Gem ${participant.name}`
                    }
                  >
                    <input type="hidden" name="meeting_id" value={meeting.id} />
                    <input
                      type="hidden"
                      name="subject_partner_profile_id"
                      value={participant.partnerProfileId}
                    />
                    <Select name="score" label={participant.name} defaultValue="" required>
                      <option value="" disabled>
                        Vælg
                      </option>
                      {SCORE_OPTIONS.map((score) => (
                        <option key={score} value={score}>
                          {score}
                        </option>
                      ))}
                    </Select>
                  </AuthForm>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
