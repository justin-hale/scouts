import { useMemo } from "react";
import type { CalendarEvent, Category } from "../types";
import { compareEvents, formatDateLabel, formatTimeRange } from "../utils/dates";

/**
 * A compact, flat list of events (one card each), sorted by date. The date
 * lives in the card itself, so there are no per-day section headers — well
 * suited to the typical one-event-per-day cadence. The caller decides which
 * events to pass (e.g. "upcoming" for the agenda, "this month" for the month
 * view); this component just sorts and renders them.
 */
export function EventList({
  events,
  categories,
  onSelect,
  emptyMessage,
}: {
  events: CalendarEvent[];
  categories: Category[];
  onSelect: (event: CalendarEvent) => void;
  emptyMessage: string;
}) {
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const sorted = useMemo(
    () => [...events].sort(compareEvents),
    [events]
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sorted.map((event) => {
        const cat = event.categoryId
          ? catById.get(event.categoryId)
          : undefined;
        return (
          <li key={event.id}>
            <button
              onClick={() => onSelect(event)}
              className="flex w-full items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
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
                <div className="truncate text-sm text-slate-500">
                  {formatDateLabel(event.date)}
                  {event.location && ` · ${event.location}`}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
