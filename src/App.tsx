import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import type { CalendarEvent, CalendarView } from "./types";
import { useCalendarData } from "./hooks/useCalendarData";
import { monthSlug, parseMonthSlug } from "./utils/monthUrl";
import { ViewSwitcher } from "./components/ViewSwitcher";
import { AgendaView } from "./components/AgendaView";
import { WeekView } from "./components/WeekView";
import { MonthView } from "./components/MonthView";
import { EventModal } from "./components/EventModal";
import { EventEditor } from "./components/EventEditor";
import { CategoryManager } from "./components/CategoryManager";
import { LoginModal } from "./components/LoginModal";

function defaultView(): CalendarView {
  return window.matchMedia("(min-width: 768px)").matches ? "month" : "agenda";
}

function periodLabel(view: CalendarView, cursor: Date): string {
  if (view === "month") return format(cursor, "MMMM yyyy");
  if (view === "week") {
    const start = startOfWeek(cursor);
    const end = endOfWeek(cursor);
    const sameMonth = format(start, "MMM") === format(end, "MMM");
    return sameMonth
      ? `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
      : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return "Upcoming";
}

export default function App() {
  const cal = useCalendarData();
  // A "/august-2026"-style URL opens straight to that month.
  const urlMonth = useMemo(() => parseMonthSlug(window.location.pathname), []);
  const [view, setView] = useState<CalendarView>(() =>
    urlMonth ? "month" : defaultView()
  );
  const [cursor, setCursor] = useState<Date>(() => urlMonth ?? new Date());

  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [editing, setEditing] = useState<
    { event?: CalendarEvent; date?: string } | null
  >(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  // Keep the detail modal's event in sync if the underlying data changes.
  const selectedCategory = useMemo(
    () =>
      selected?.categoryId
        ? cal.data.categories.find((c) => c.id === selected.categoryId)
        : undefined,
    [selected, cal.data.categories]
  );

  // If the signed-in editor signs out, close edit-only surfaces.
  useEffect(() => {
    if (!cal.isAuthed) {
      setEditing(null);
      setShowCategories(false);
    }
  }, [cal.isAuthed]);

  // Reflect the visible month in the URL so it can be shared/bookmarked.
  // Month view -> "/august-2026"; other views fall back to "/".
  useEffect(() => {
    const path = view === "month" ? monthSlug(cursor) : "/";
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path + window.location.hash);
    }
  }, [view, cursor]);

  const step = (dir: 1 | -1) => {
    setCursor((c) =>
      view === "month"
        ? dir === 1
          ? addMonths(c, 1)
          : subMonths(c, 1)
        : dir === 1
          ? addWeeks(c, 1)
          : subWeeks(c, 1)
    );
  };

  const handleSaveEvent = async (event: CalendarEvent) => {
    await cal.saveEvent(event);
    setEditing(null);
    setSelected(null);
  };

  const handleDeleteEvent = async (event: CalendarEvent) => {
    if (!confirm(`Delete "${event.title}"?`)) return;
    await cal.deleteEvent(event.id);
    setSelected(null);
  };

  return (
    <div className="min-h-full bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-[#1d3461] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-amber-300">
              <path d="M12 2 4 7v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V7l-8-5Z" opacity=".25" />
              <path d="m12 6 1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 14.7 8.8 16.4l.6-3.6L6.8 9.8l3.6-.5L12 6Z" />
            </svg>
            <h1 className="text-lg font-bold tracking-tight">Cub Scouts Calendar</h1>
          </div>
          {cal.isAuthed ? (
            <div className="flex items-center gap-2 text-sm">
              {cal.saving && <span className="text-blue-200">Saving…</span>}
              <button
                onClick={() => setShowCategories(true)}
                className="rounded-lg px-2.5 py-1.5 font-medium text-white/90 hover:bg-white/10"
              >
                Categories
              </button>
              <button
                onClick={cal.logout}
                className="rounded-lg px-2.5 py-1.5 font-medium text-white/90 hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {view !== "agenda" && (
              <>
                <button
                  onClick={() => step(-1)}
                  aria-label="Previous"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                >
                  ‹
                </button>
                <button
                  onClick={() => setCursor(new Date())}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Today
                </button>
                <button
                  onClick={() => step(1)}
                  aria-label="Next"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                >
                  ›
                </button>
              </>
            )}
            <h2 className="ml-1 text-lg font-semibold text-slate-700">
              {periodLabel(view, cursor)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <ViewSwitcher view={view} onChange={setView} />
            {cal.isAuthed && (
              <button
                onClick={() => setEditing({})}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                + Add event
              </button>
            )}
          </div>
        </div>

        {cal.loading ? (
          <p className="py-16 text-center text-slate-400">Loading calendar…</p>
        ) : cal.error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
            <p>{cal.error}</p>
            <button
              onClick={() => void cal.reload()}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : view === "agenda" ? (
          <AgendaView
            events={cal.data.events}
            categories={cal.data.categories}
            onSelect={setSelected}
          />
        ) : view === "week" ? (
          <WeekView
            cursor={cursor}
            events={cal.data.events}
            categories={cal.data.categories}
            onSelect={setSelected}
          />
        ) : (
          <MonthView
            cursor={cursor}
            events={cal.data.events}
            categories={cal.data.categories}
            canEdit={cal.isAuthed}
            onSelect={setSelected}
            onAddOnDate={(date) => setEditing({ date })}
          />
        )}
      </main>

      {selected && (
        <EventModal
          event={selected}
          category={selectedCategory}
          canEdit={cal.isAuthed}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing({ event: selected });
            setSelected(null);
          }}
          onDelete={() => void handleDeleteEvent(selected)}
        />
      )}

      {editing && (
        <EventEditor
          initial={editing.event}
          defaultDate={editing.date}
          categories={cal.data.categories}
          onCancel={() => setEditing(null)}
          onSave={handleSaveEvent}
        />
      )}

      {showCategories && (
        <CategoryManager
          categories={cal.data.categories}
          onClose={() => setShowCategories(false)}
          onSave={cal.saveCategory}
          onDelete={cal.deleteCategory}
        />
      )}

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSubmit={async (pw) => {
            const ok = await cal.login(pw);
            if (ok) setShowLogin(false);
            return ok;
          }}
        />
      )}
    </div>
  );
}
