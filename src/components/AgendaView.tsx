import { useMemo } from "react";
import type { CalendarEvent, Category } from "../types";
import { todayISO } from "../utils/dates";
import { EventList } from "./EventList";

export function AgendaView({
  events,
  categories,
  onSelect,
}: {
  events: CalendarEvent[];
  categories: Category[];
  onSelect: (event: CalendarEvent) => void;
}) {
  const upcoming = useMemo(() => {
    const today = todayISO();
    return events.filter((e) => e.date >= today);
  }, [events]);

  return (
    <EventList
      events={upcoming}
      categories={categories}
      onSelect={onSelect}
      emptyMessage="No upcoming events."
    />
  );
}
