import { useMemo } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarEvent, Category } from "../types";
import { compareEvents } from "../utils/dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({
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

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDate.get(iso) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day);
          return (
            <div
              key={iso}
              className={`min-h-24 border-b border-r border-slate-100 p-1 sm:min-h-28 ${
                inMonth ? "bg-white" : "bg-slate-50/60"
              }`}
            >
              <div className="mb-1 flex justify-end">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    today
                      ? "bg-blue-600 font-semibold text-white"
                      : inMonth
                        ? "text-slate-700"
                        : "text-slate-400"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((event) => {
                  const cat = event.categoryId
                    ? catById.get(event.categoryId)
                    : undefined;
                  const color = cat?.color ?? "#64748b";
                  return (
                    <button
                      key={event.id}
                      onClick={() => onSelect(event)}
                      title={event.title}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium hover:brightness-95"
                      style={{ backgroundColor: `${color}1a`, color }}
                    >
                      {event.title}
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="px-1 text-xs text-slate-400">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
