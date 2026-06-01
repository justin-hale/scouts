import { useState } from "react";
import type { CalendarEvent, Category } from "../types";
import { todayISO } from "../utils/dates";
import { Modal } from "./Modal";

function blankEvent(): CalendarEvent {
  return {
    id: crypto.randomUUID(),
    title: "",
    date: todayISO(),
    allDay: false,
    startTime: "18:30",
    endTime: "",
    location: "",
    description: "",
    categoryId: null,
  };
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

export function EventEditor({
  initial,
  categories,
  onCancel,
  onSave,
}: {
  /** Existing event to edit, or undefined to create a new one. */
  initial?: CalendarEvent;
  categories: Category[];
  onCancel: () => void;
  onSave: (event: CalendarEvent) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CalendarEvent>(initial ?? blankEvent());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof CalendarEvent>(
    key: K,
    value: CalendarEvent[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setError("Please enter a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, title: draft.title.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <Modal
      title={initial ? "Edit event" : "New event"}
      onClose={onCancel}
      footer={
        <div className="flex items-center justify-end gap-3">
          {error && <span className="mr-auto text-sm text-red-600">{error}</span>}
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <input
            className={inputClass}
            value={draft.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. Weekly Den Meeting"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <input
              type="date"
              className={inputClass}
              value={draft.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </Field>
          <Field label="Category">
            <select
              className={inputClass}
              value={draft.categoryId ?? ""}
              onChange={(e) =>
                update("categoryId", e.target.value || null)
              }
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => update("allDay", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          All-day event
        </label>

        {!draft.allDay && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start time">
              <input
                type="time"
                className={inputClass}
                value={draft.startTime}
                onChange={(e) => update("startTime", e.target.value)}
              />
            </Field>
            <Field label="End time (optional)">
              <input
                type="time"
                className={inputClass}
                value={draft.endTime}
                onChange={(e) => update("endTime", e.target.value)}
              />
            </Field>
          </div>
        )}

        <Field label="Location">
          <input
            className={inputClass}
            value={draft.location}
            onChange={(e) => update("location", e.target.value)}
            placeholder="e.g. Community Center, Room B"
          />
        </Field>

        <Field label="Description">
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            value={draft.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Details… URLs become links. Markdown supported."
          />
          <span className="mt-1 block text-xs text-slate-400">
            Tip: paste a link and it becomes clickable. Use **bold** and lists too.
          </span>
        </Field>
      </div>
    </Modal>
  );
}
