/**
 * Inputvalidering til tilgængelighedsformularerne (fase 5.3). Ren funktion, ingen I/O — hører
 * ikke til i actions.ts, fordi en "use server"-fil kun må eksportere async-funktioner, og fordi
 * reglerne skal kunne enhedstestes. Fejlbeskederne er brugervendte (dansk) og kastes som Error;
 * actions oversætter dem til formularens `{ error }`.
 *
 * Databasen håndhæver det samme (check-constraints i 0018): valideringen her er for at give en
 * forståelig besked, ikke for at være eneste forsvar.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface SlotInput {
  weekdays: number[];
  startTime: string;
  endTime: string;
}

export interface AbsenceInput {
  startsOn: string;
  endsOn: string;
  note: string | null;
}

/** Maks. længde på fraværsnoten — spejler check-constrainten i 0018. */
export const ABSENCE_NOTE_MAX = 500;

export function parseSlotInput(raw: {
  weekdays: string[];
  startTime: string;
  endTime: string;
}): SlotInput {
  const weekdays = [...new Set(raw.weekdays.map(Number))].sort((a, b) => a - b);
  if (weekdays.length === 0) throw new Error("Vælg mindst én ugedag.");
  if (weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new Error("Ugyldig ugedag.");
  }
  const startTime = raw.startTime.trim();
  const endTime = raw.endTime.trim();
  if (!TIME.test(startTime) || !TIME.test(endTime)) {
    throw new Error("Angiv start- og sluttidspunkt som klokkeslæt (tt:mm).");
  }
  if (endTime <= startTime) throw new Error("Sluttidspunktet skal ligge efter starttidspunktet.");
  return { weekdays, startTime, endTime };
}

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseAbsenceInput(raw: {
  startsOn: string;
  endsOn: string;
  note: string;
}): AbsenceInput {
  const startsOn = raw.startsOn.trim();
  const endsOn = raw.endsOn.trim();
  if (!isRealDate(startsOn) || !isRealDate(endsOn)) {
    throw new Error("Angiv både fra- og til-dato.");
  }
  if (endsOn < startsOn) throw new Error("Til-datoen kan ikke ligge før fra-datoen.");
  const note = raw.note.trim();
  if (note.length > ABSENCE_NOTE_MAX) {
    throw new Error(`Noten må højst være ${ABSENCE_NOTE_MAX} tegn.`);
  }
  return { startsOn, endsOn, note: note.length > 0 ? note : null };
}
