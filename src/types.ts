export interface Category {
  id: string;
  name: string;
  /** Hex color, e.g. "#2563eb". */
  color: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  /** True for all-day events; when true start/end times are ignored. */
  allDay: boolean;
  /** "HH:mm" 24h local time. Empty string when allDay. */
  startTime: string;
  /** "HH:mm" 24h local time. Optional even for timed events. */
  endTime: string;
  location: string;
  /** Markdown; bare URLs are auto-linked. */
  description: string;
  categoryId: string | null;
}

/** The full document stored in the Gist. */
export interface CalendarData {
  categories: Category[];
  events: CalendarEvent[];
}

export type CalendarView = "agenda" | "week" | "month";
