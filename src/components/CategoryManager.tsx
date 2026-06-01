import { useState } from "react";
import type { Category } from "../types";
import { Modal } from "./Modal";

const DEFAULT_COLOR = "#2563eb";

function CategoryRow({
  category,
  onSave,
  onDelete,
}: {
  category: Category;
  onSave: (c: Category) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [busy, setBusy] = useState(false);
  const dirty = name !== category.name || color !== category.color;

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({ ...category, name: name.trim(), color });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete category "${category.name}"? Events keep their data but lose this label.`))
      return;
    setBusy(true);
    try {
      await onDelete(category.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-slate-300"
        aria-label="Category color"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      />
      {dirty && (
        <button
          onClick={save}
          disabled={busy}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Save
        </button>
      )}
      <button
        onClick={remove}
        disabled={busy}
        aria-label="Delete category"
        className="shrink-0 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        Delete
      </button>
    </div>
  );
}

export function CategoryManager({
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  categories: Category[];
  onClose: () => void;
  onSave: (c: Category) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onSave({
        id: crypto.randomUUID(),
        name: newName.trim(),
        color: newColor,
      });
      setNewName("");
      setNewColor(DEFAULT_COLOR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="space-y-3">
        {categories.length === 0 && (
          <p className="text-sm text-slate-500">No categories yet.</p>
        )}
        {categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}

        <div className="mt-4 border-t border-slate-200 pt-4">
          <span className="mb-2 block text-sm font-medium text-slate-600">
            Add a category
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded border border-slate-300"
              aria-label="New category color"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Category name"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
            <button
              onClick={add}
              disabled={busy || !newName.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
