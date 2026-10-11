import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { AvailabilityWeek } from "@/components/AvailabilityWeek";
import { Checkbox } from "@/components/Checkbox";
import { Field } from "@/components/Field";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { getCurrentUser } from "@/server/auth";
import { getMyAvailability } from "@/server/availability";
import {
  addAbsence,
  addAvailabilitySlots,
  removeAbsence,
  removeAvailabilitySlot,
} from "@/server/availability/actions";
import { copenhagenDateOf } from "@/server/availability/algorithm";
import { WEEKDAYS } from "@/server/availability/labels";
import { getMyPartnerProfile } from "@/server/partners/portal";

export const metadata: Metadata = { title: "Tilgængelighed — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-12" (ren kalenderdato) → "12. oktober 2026". UTC her er kun for at undgå dag-skift. */
function formatDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

/**
 * Partnerens tilgængelighed (fase 5.3, bygget skærm-først — ADR 0042/0052). Supabase er
 * sandhedskilden; synk til Cal.com-schedules er et senere skridt (stub-register).
 */
export default async function PartnerAvailabilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("partner")) redirect("/dashboard");

  const profile = await getMyPartnerProfile();
  const availability = profile ? await getMyAvailability(profile.id) : null;
  const today = copenhagenDateOf(new Date());
  // Afsluttet fravær er historik; det fylder kun i vejen i oversigten.
  const absences = availability?.absences.filter((a) => a.endsOn >= today) ?? [];

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/partner">Partner</Link> · Tilgængelighed
          </>
        }
        title="Din tilgængelighed"
        lead="Angiv de tider på ugen hvor du kan holde board-møder, og registrér fravær. Booking afviser tidspunkter uden for dine tider. Alle tider er dansk tid."
      />
      <PageBody>
        {!profile || !availability ? (
          <p className="form__notice" role="status">
            Din bruger er endnu ikke koblet til en katalogprofil. Kontakt administratoren.
          </p>
        ) : (
          <>
            <section className="stack">
              <h2 className="heading-3 heading--on-light">Din uge</h2>
              {/* TODO(ejer): "ikke angivet" = ingen begrænsning er en pladsholder (algorithm.ts). */}
              {availability.slots.length === 0 ? (
                <p className="empty">
                  Du har ikke angivet faste tider. Indtil du gør det, kan du bookes på alle
                  tidspunkter — uden for dit eventuelle fravær.
                </p>
              ) : null}
              <AvailabilityWeek slots={availability.slots} removeAction={removeAvailabilitySlot} />
            </section>

            <section className="panel measure">
              <h2 className="heading-3 heading--on-light">Tilføj tider</h2>
              <p className="body">
                Vælg de ugedage tidsvinduet gælder for. Du kan tilføje flere vinduer på samme
                dag, fx formiddag og eftermiddag.
              </p>
              <AuthForm action={addAvailabilitySlots} submitLabel="Tilføj tider">
                <div className="checkbox-group" role="group" aria-label="Ugedage">
                  {WEEKDAYS.map((day) => (
                    <Checkbox key={day.iso} name="weekday" value={String(day.iso)} label={day.label} />
                  ))}
                </div>
                <Field name="start_time" label="Fra" type="time" required />
                <Field name="end_time" label="Til" type="time" required />
              </AuthForm>
            </section>

            <section className="stack section-rule">
              <h2 className="heading-3 heading--on-light">Fravær</h2>
              <p className="body measure">
                Fravær overstyrer dine ugentlige tider. Hele dage, begge dage medregnet.
              </p>
              {absences.length === 0 ? (
                <p className="empty">Du har ikke registreret kommende fravær.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="table__head">Fra</th>
                        <th className="table__head">Til</th>
                        <th className="table__head">Note</th>
                        <th className="table__head">Handling</th>
                      </tr>
                    </thead>
                    <tbody>
                      {absences.map((absence) => (
                        <tr key={absence.id} className="table__row">
                          <td className="table__cell">{formatDate(absence.startsOn)}</td>
                          <td className="table__cell">{formatDate(absence.endsOn)}</td>
                          <td className="table__cell">{absence.note ?? "—"}</td>
                          <td className="table__cell">
                            <form action={removeAbsence}>
                              <input type="hidden" name="absence_id" value={absence.id} />
                              <button className="btn-secondary" type="submit">
                                Fjern
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="panel measure">
                <h3 className="heading-3 heading--on-light">Registrér fravær</h3>
                <AuthForm action={addAbsence} submitLabel="Registrér fravær">
                  <Field name="starts_on" label="Fra dato" type="date" required />
                  <Field name="ends_on" label="Til dato" type="date" required />
                  <Field name="note" label="Note (valgfri)" maxLength={500} />
                  <p className="body">
                    Noten er kun synlig for dig og administratoren. Skriv ikke årsagen — og aldrig
                    helbredsoplysninger.
                  </p>
                </AuthForm>
              </div>
            </section>
          </>
        )}

        <p className="body">
          <Link href="/partner">Til partnerportalen</Link>
        </p>
      </PageBody>
    </>
  );
}
