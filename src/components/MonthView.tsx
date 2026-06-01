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
import { EventList } from "./EventList";

export function MonthView({
  cursor,
  events,
  categories,
  canEdit,
  onSelect,
  onAddOnDate,
}: {
  cursor: Date;
  events: CalendarEvent[];
  categories: Category[];
  canEdit: boolean;
  onSelect: (event: CalendarEvent) => void;
  /** Called when an editor clicks an empty part of a day cell. */
  onAddOnDate: (dateISO: string) => void;
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

  // Events that fall within the displayed month, for the list below the grid.
  const monthKey = format(cursor, "yyyy-MM");
  const monthEvents = useMemo(
    () => events.filter((e) => e.date.slice(0, 7) === monthKey),
    [events, monthKey]
  );
  const monthLabel = format(cursor, "MMMM yyyy");

  return (
    <div className="space-y-6">
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
                onClick={canEdit ? () => onAddOnDate(iso) : undefined}
                title={canEdit ? "Add event on this day" : undefined}
                className={`group min-h-24 border-b border-r border-slate-100 p-1 sm:min-h-28 ${
                  inMonth ? "bg-white" : "bg-slate-50/60"
                } ${canEdit ? "cursor-pointer hover:bg-blue-50/60" : ""}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  {canEdit ? (
                    <span className="px-1 text-sm leading-none text-blue-500 opacity-0 transition group-hover:opacity-100">
                      +
                    </span>
                  ) : (
                    <span />
                  )}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(event);
                        }}
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

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-700">
          {monthLabel}
        </h2>
        <EventList
          events={monthEvents}
          categories={categories}
          onSelect={onSelect}
          emptyMessage="No events this month."
        />
      </section>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
