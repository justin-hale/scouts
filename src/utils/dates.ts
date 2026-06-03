import { format, parse } from "date-fns";

/** Today as a "YYYY-MM-DD" string in local time. */
export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Parse a "YYYY-MM-DD" string into a local Date (midnight). */
export function parseDate(iso: string): Date {
  return parse(iso, "yyyy-MM-dd", new Date());
}

/** Format a "YYYY-MM-DD" date string for display, e.g. "Sat, Jun 14". */
export function formatDateLabel(iso: string): string {
  return format(parseDate(iso), "EEE, MMM d");
}

/** Format a "YYYY-MM-DD" date string with year, e.g. "Saturday, June 14, 2026". */
export function formatDateLong(iso: string): string {
  return format(parseDate(iso), "EEEE, MMMM d, yyyy");
}

/** Format a "YYYY-MM-DD" date string as its month, e.g. "June 2026". */
export function formatMonthLabel(iso: string): string {
  return format(parseDate(iso), "MMMM yyyy");
}

/** Convert "HH:mm" 24h into a friendly "7:00 PM". Returns "" if empty/invalid. */
export function formatTime(hhmm: string): string {
  if (!hhmm) return "";
  const parsed = parse(hhmm, "HH:mm", new Date());
  if (Number.isNaN(parsed.getTime())) return "";
  return format(parsed, "h:mm a");
}

/** Human time range for an event, e.g. "7:00 PM – 8:30 PM" or "All day". */
export function formatTimeRange(
  allDay: boolean,
  startTime: string,
  endTime: string
): string {
  if (allDay || !startTime) return "All day";
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  return end ? `${start} – ${end}` : start;
}

/** Sort comparator: by date, then all-day first, then start time. */
export function compareEvents(
  a: { date: string; allDay: boolean; startTime: string },
  b: { date: string; allDay: boolean; startTime: string }
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.startTime || "").localeCompare(b.startTime || "");
}
