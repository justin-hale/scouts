import type { CalendarView } from "../types";

const OPTIONS: { value: CalendarView; label: string }[] = [
  { value: "agenda", label: "Agenda" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: CalendarView;
  onChange: (view: CalendarView) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">Calendar view</span>
      <select
        value={view}
        onChange={(e) => onChange(e.target.value as CalendarView)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} view
          </option>
        ))}
      </select>
    </label>
  );
}
