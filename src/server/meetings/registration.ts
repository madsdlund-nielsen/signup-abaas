/**
 * Hvornår må en partner registrere sin mødestatus? (fase 6.1, fund fra e2e.)
 *
 * Før denne regel kunne en partner registrere et møde ni dage ude i fremtiden som «afholdt» — det
 * satte mødets status til afholdt og gav en honorarlinje for et møde der ikke havde fundet sted.
 * Reglen er teknisk, ikke en forretningsbeslutning: et møde kan hverken være afholdt eller have en
 * udeblivelse før det er begyndt. «Forsinket afbud» er netop noget der sker FØR mødet og er altid
 * tilladt. Hvad registreringen koster (honorar ved udeblivelse/sent afbud) er stadig ejerens.
 * TODO(ejer): honorar ved udeblivelse/sent afbud.
 */

import type { MeetingRegisteredStatus } from "./index";

/** Statusser der forudsætter at mødet er begyndt. */
const REQUIRES_STARTED: ReadonlySet<MeetingRegisteredStatus> = new Set(["afholdt", "udeblivelse"]);

/** Kan denne status registreres nu? `startsAt` er mødets starttidspunkt (ISO). */
export function canRegisterStatus(
  status: MeetingRegisteredStatus,
  startsAt: string | Date,
  now: Date = new Date(),
): boolean {
  if (!REQUIRES_STARTED.has(status)) return true;
  return new Date(startsAt).getTime() <= now.getTime();
}

export const NOT_STARTED_MESSAGE =
  "Mødet er ikke begyndt endnu — det kan først registreres som afholdt eller udeblivelse når det er startet.";
