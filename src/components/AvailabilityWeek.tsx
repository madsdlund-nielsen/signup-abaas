import { WEEKDAYS, formatTime } from "@/server/availability/labels";

export interface WeekSlot {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/**
 * Ugeoversigt over en partners faste ugentlige vinduer (fase 5.3): syv kolonner, mandag til
 * søndag, med vinduerne som rolige blokke. Al styling via token-klasser (.weekgrid*) —
 * ingen inline-styles, farver eller spacing hardcodet.
 *
 * Fjernelse sker via den server-action kalderen sender ind (`removeAction`); komponenten kender
 * hverken Supabase eller ejerskabstjekket. Uden `removeAction` er oversigten skrivebeskyttet.
 */
export function AvailabilityWeek({
  slots,
  removeAction,
}: {
  slots: WeekSlot[];
  removeAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="weekgrid" role="list" aria-label="Ugeoversigt">
      {WEEKDAYS.map((day) => {
        const daySlots = slots
          .filter((slot) => slot.weekday === day.iso)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div key={day.iso} className="weekgrid__day" role="listitem">
            <h3 className="weekgrid__label" title={day.label}>
              {day.short}
            </h3>
            {daySlots.length === 0 ? (
              <p className="weekgrid__none">—</p>
            ) : (
              <ul className="weekgrid__slots">
                {daySlots.map((slot) => (
                  <li key={slot.id} className="weekgrid__slot">
                    <span className="weekgrid__time">
                      {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
                    </span>
                    {removeAction ? (
                      <form action={removeAction}>
                        <input type="hidden" name="slot_id" value={slot.id} />
                        <button
                          className="weekgrid__remove"
                          type="submit"
                          aria-label={`Fjern ${day.label} ${formatTime(slot.startTime)}–${formatTime(slot.endTime)}`}
                        >
                          Fjern
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
