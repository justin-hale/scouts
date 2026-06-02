import { useMemo } from "react";
import type { CalendarEvent, Category } from "../types";

/**
 * A glanceable color key shown above the calendar. Each badge shows the
 * category color, its name, and how many events currently use it.
 */
export function Legend({
  categories,
  events,
}: {
  categories: Category[];
  events: CalendarEvent[];
}) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.categoryId) map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1);
    }
    return map;
  }, [events]);

  if (categories.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {categories.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: `${c.color}1a`, color: c.color }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: c.color }}
          />
          {c.name}
          <span
            className="rounded-full bg-white/70 px-1.5 text-[11px] font-semibold tabular-nums"
            style={{ color: c.color }}
          >
            {counts.get(c.id) ?? 0}
          </span>
        </span>
      ))}
    </div>
  );
}
