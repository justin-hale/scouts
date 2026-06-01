import { useMemo } from "react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import type { CalendarEvent, Category } from "../types";
import { compareEvents, formatTimeRange } from "../utils/dates";

export function WeekView({
  cursor,
  events,
  categories,
  onSelect,
}: {
  cursor: Date;
  events: CalendarEvent[];
  categories: Category[];
  onSelect: (event: CalendarEvent) => void;
}) {
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(cursor),
        end: endOfWeek(cursor),
      }),
    [cursor]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of [...events].sort(compareEvents)) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-2">
      {days.map((day) => {
        const iso = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDate.get(iso) ?? [];
        const today = isToday(day);
        return (
          <div
            key={iso}
            className={`rounded-xl border bg-white p-2 shadow-sm ${
              today ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between border-b border-slate-100 pb-1.5">
              <span className="text-sm font-semibold text-slate-700">
                {format(day, "EEE")}
              </span>
              <span
                className={`text-sm ${today ? "font-semibold text-blue-600" : "text-slate-400"}`}
              >
                {format(day, "MMM d")}
              </span>
            </div>
            <div className="space-y-1.5">
              {dayEvents.length === 0 && (
                <p className="px-1 py-2 text-xs text-slate-300">—</p>
              )}
              {dayEvents.map((event) => {
                const cat = event.categoryId
                  ? catById.get(event.categoryId)
                  : undefined;
                const color = cat?.color ?? "#64748b";
                return (
                  <button
                    key={event.id}
                    onClick={() => onSelect(event)}
                    className="block w-full rounded-lg border-l-4 bg-slate-50 px-2 py-1.5 text-left hover:bg-slate-100"
                    style={{ borderColor: color }}
                  >
                    <div className="truncate text-sm font-medium text-slate-800">
                      {event.title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatTimeRange(
                        event.allDay,
                        event.startTime,
                        event.endTime
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
