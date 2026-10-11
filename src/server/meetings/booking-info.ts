/**
 * Rene hjælpere til booking mod boardets collective event type (ADR 0046, B-23) — adskilt fra
 * server-actions, så de kan unit-testes uden Supabase og uden "use server"-eksportreglerne.
 */

import { DEMO_EVENT_TYPE_ID, type BookingAttendee, type BookingProvider } from "@/lib/booking";
import { NotConfiguredError } from "@/lib/errors";
import { DEFAULT_TIME_ZONE } from "@/server/account/validation";

/** Mødelængde hos Cal.com (byggespec §4: 60 min; de 15 min forberedelse er domænets, ikke kalenderens). */
export const MEETING_LENGTH_MINUTES = 60;

/** Ejerens kontoprofil, som Cal.com-attendee'en bygges af (`app_user`, 0024 / ADR 0061). */
export interface OwnerAccount {
  email: string;
  displayName: string | null;
  timeZone: string | null;
}

/**
 * Ejeren som Cal.com-attendee. Navn og tidszone kommer fra kontoprofilen (`/konto`):
 * Cal.com kræver et ikke-tomt navn, så en ejer der ikke har angivet et får e-mailadressen —
 * som før profilen fandtes — frem for et opfundet navn. Tidszonen er altid sat på kontoen
 * (kolonnen har en default); `DEFAULT_TIME_ZONE` er kun værn mod en række uden værdi.
 */
export function ownerAttendee(owner: OwnerAccount): BookingAttendee {
  return {
    name: owner.displayName?.trim() || owner.email,
    email: owner.email,
    timeZone: owner.timeZone || DEFAULT_TIME_ZONE,
  };
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
