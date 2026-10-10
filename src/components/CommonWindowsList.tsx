import { TIME_ZONE } from "@/server/availability/algorithm";

export interface CommonWindow {
  /** ISO-tidspunkter. */
  start: string;
  end: string;
}

const dayFormat = new Intl.DateTimeFormat("da-DK", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TIME_ZONE,
});
// 24-timers "09:00" som i ugeoversigten (da-DK skriver "09.00"; ét format på tværs af skærmene).
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});
const shortDayFormat = new Intl.DateTimeFormat("da-DK", {
  weekday: "short",
  timeZone: TIME_ZONE,
});

/**
 * Boardets fælles ledige vinduer (fase 5.3), grupperet pr. dag i dansk tid. Hjælp til ejeren
 * før hun vælger starttidspunkt — ikke en booking: vinduerne er et overblik, og vagten i
 * booking-flowet afgør til sidst. Styling via token-klasser (.slotlist*).
 */
export function CommonWindowsList({
  windows,
  anyRestriction,
  restrictedNames,
}: {
  windows: CommonWindow[];
  anyRestriction: boolean;
  restrictedNames: string[];
}) {
  if (!anyRestriction) {
    return (
      <p className="body">
        Ingen af dine rådgivere har begrænset deres tilgængelighed — alle tidspunkter kan
        bookes.
      </p>
    );
  }

  if (windows.length === 0) {
    return (
      <p className="empty">
        Der er ingen tidspunkter de næste syv dage hvor hele boardet er ledigt. Prøv en senere
        uge.
      </p>
    );
  }

  const byDay = new Map<string, CommonWindow[]>();
  for (const window of windows) {
    const key = dayFormat.format(new Date(window.start));
    byDay.set(key, [...(byDay.get(key) ?? []), window]);
  }

  return (
    <div className="stack">
      <dl className="slotlist">
        {[...byDay.entries()].map(([day, dayWindows]) => (
          <div key={day} className="slotlist__row">
            <dt className="slotlist__day">{day}</dt>
            <dd className="slotlist__times">
              {dayWindows.map((window) => {
                const start = new Date(window.start);
                const end = new Date(window.end);
                const crossesMidnight = dayFormat.format(start) !== dayFormat.format(end);
                return (
                  <span key={window.start} className="slotlist__time">
                    {timeFormat.format(start)}–{timeFormat.format(end)}
                    {crossesMidnight ? ` (${shortDayFormat.format(end)})` : ""}
                  </span>
                );
              })}
            </dd>
          </div>
        ))}
      </dl>
      <p className="body slotlist__note">
        Begrænset af {restrictedNames.join(", ")}. Tiderne er dansk tid.
      </p>
    </div>
  );
}
