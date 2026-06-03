import { useMemo } from "react";
import type { CalendarEvent, Category } from "../types";
import {
  compareEvents,
  formatDateLabel,
  formatMonthLabel,
  formatTimeRange,
} from "../utils/dates";

/**
 * A compact, flat list of events (one card each), sorted by date. The date
 * lives in the card itself, so there are no per-day section headers — well
 * suited to the typical one-event-per-day cadence. The caller decides which
 * events to pass (e.g. "upcoming" for the agenda, "this month" for the month
 * view); this component just sorts and renders them.
 *
 * When `groupByMonth` is set, cards are grouped under a month heading
 * ("June 2026") so a long, multi-month list reads clearly by month.
 */
export function EventList({
  events,
  categories,
  onSelect,
  emptyMessage,
  groupByMonth = false,
}: {
  events: CalendarEvent[];
  categories: Category[];
  onSelect: (event: CalendarEvent) => void;
  emptyMessage: string;
  groupByMonth?: boolean;
}) {
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const sorted = useMemo(() => [...events].sort(compareEvents), [events]);

  // Sorted list grouped into consecutive months, e.g. [["June 2026", [...]]].
  const months = useMemo(() => {
    const groups: [string, CalendarEvent[]][] = [];
    for (const e of sorted) {
      const label = formatMonthLabel(e.date);
      const last = groups[groups.length - 1];
      if (last && last[0] === label) last[1].push(e);
      else groups.push([label, [e]]);
    }
    return groups;
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const card = (event: CalendarEvent) => {
    const cat = event.categoryId ? catById.get(event.categoryId) : undefined;
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
                {formatTimeRange(event.allDay, event.startTime, event.endTime)}
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
  };

  if (!groupByMonth) {
    return <ul className="space-y-2">{sorted.map(card)}</ul>;
  }

  return (
    <div className="space-y-6">
      {months.map(([label, monthEvents]) => (
        <section key={label}>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {label}
          </h2>
          <ul className="space-y-2">{monthEvents.map(card)}</ul>
        </section>
      ))}
    </div>
  );
}
