/**
 * Rene hjælpere til booking mod boardets collective event type (ADR 0046, B-23) — adskilt fra
 * server-actions, så de kan unit-testes uden Supabase og uden "use server"-eksportreglerne.
 */

import { DEMO_EVENT_TYPE_ID, type BookingAttendee, type BookingProvider } from "@/lib/booking";
import { NotConfiguredError } from "@/lib/errors";

/** Mødelængde hos Cal.com (byggespec §4: 60 min; de 15 min forberedelse er domænets, ikke kalenderens). */
export const MEETING_LENGTH_MINUTES = 60;

/**
 * Cal.com kræver en tidszone på attendee. Vi gemmer ingen pr. ejer endnu, og alle ejere er danske.
 * TODO(mads): gem ejerens tidszone (profil/onboarding) frem for at antage København.
 */
export const OWNER_TIME_ZONE = "Europe/Copenhagen";

/**
 * Ejeren som Cal.com-attendee. Navn: vi indsamler ikke et ejernavn (app_user har kun e-mail),
 * så e-mailadressen bruges — Cal.com kræver et ikke-tomt navn, og et opfundet navn ville være
 * et gæt. TODO(mads): indsaml ejerens navn ved onboarding.
 */
export function ownerAttendee(email: string): BookingAttendee {
  return { name: email, email, timeZone: OWNER_TIME_ZONE };
}

/**
 * Boardets event type-id til en booking. Rigtig tilstand uden id fejler HØJLYDT (boardet har
 * intet collective event type endnu); demo fortsætter med det åbenlyst falske id; stub lader
 * porten svare ærligt med NotConfiguredError.
 */
export function resolveEventTypeId(provider: Pick<BookingProvider, "name">, stored: number | null): number {
  if (stored != null) return stored;
  if (provider.name === "demo") return DEMO_EVENT_TYPE_ID;
  if (provider.name === "stub") throw new NotConfiguredError("cal.com", "createMultiHostMeeting");
  throw new Error(
    "Boardet har endnu intet Cal.com event type og kan ikke bookes. " +
      "Opret det først (admin → Boards → Opret Cal.com-event type).",
  );
}
