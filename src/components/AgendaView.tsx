import { useMemo } from "react";
import type { CalendarEvent, Category } from "../types";
import {
  compareEvents,
  formatDateLong,
  formatTimeRange,
  todayISO,
} from "../utils/dates";

export function AgendaView({
  events,
  categories,
  onSelect,
}: {
  events: CalendarEvent[];
  categories: Category[];
  onSelect: (event: CalendarEvent) => void;
}) {
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  // Upcoming events grouped by date.
  const groups = useMemo(() => {
    const today = todayISO();
    const upcoming = events
      .filter((e) => e.date >= today)
      .sort(compareEvents);
    const byDate = new Map<string, CalendarEvent[]>();
    for (const e of upcoming) {
      const list = byDate.get(e.date) ?? [];
      list.push(e);
      byDate.set(e.date, list);
    }
    return [...byDate.entries()];
  }, [events]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
        No upcoming events.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(([date, dayEvents]) => (
        <section key={date}>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {formatDateLong(date)}
          </h2>
          <ul className="space-y-2">
            {dayEvents.map((event) => {
              const cat = event.categoryId
                ? catById.get(event.categoryId)
                : undefined;
              return (
                <li key={event.id}>
                  <button
                    onClick={() => onSelect(event)}
                    className="flex w-full items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
                  >
                    <span
                      className="w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cat?.color ?? "#cbd5e1" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold text-slate-800">
                          {event.title}
                        </span>
                        <span className="shrink-0 text-sm text-slate-500">
                          {formatTimeRange(
                            event.allDay,
                            event.startTime,
                            event.endTime
                          )}
                        </span>
                      </div>
                      {event.location && (
                        <div className="truncate text-sm text-slate-500">
                          {event.location}
                        </div>
                      )}
                      {cat && (
                        <span
                          className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: `${cat.color}1a`,
                            color: cat.color,
                          }}
                        >
                          {cat.name}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
