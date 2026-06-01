// Deep-linking to a month via clean URLs like "/august-2026".

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Build the path for a month, e.g. "/august-2026". */
export function monthSlug(date: Date): string {
  return `/${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

/**
 * Parse a pathname like "/august-2026" into a Date at the first of that month,
 * or null if it isn't a recognizable month slug.
 */
export function parseMonthSlug(pathname: string): Date | null {
  const seg = decodeURIComponent(pathname)
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const match = seg.match(/^([a-z]+)-(\d{4})$/);
  if (!match) return null;
  const monthIndex = MONTHS.indexOf(match[1]);
  if (monthIndex === -1) return null;
  return new Date(Number(match[2]), monthIndex, 1);
}
