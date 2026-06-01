import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData, CalendarEvent, Category } from "../types";
import {
  AuthError,
  fetchData,
  saveData,
  verifyPassword,
} from "../api";

const SESSION_KEY = "scouts-calendar-pw";

const EMPTY: CalendarData = { categories: [], events: [] };

export function useCalendarData() {
  const [data, setData] = useState<CalendarData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAuthed, setIsAuthed] = useState(
    () => sessionStorage.getItem(SESSION_KEY) !== null
  );

  // Password is kept only for this browser session, never persisted to disk.
  const passwordRef = useRef<string | null>(sessionStorage.getItem(SESSION_KEY));

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(async (password: string): Promise<boolean> => {
    const ok = await verifyPassword(password);
    if (ok) {
      passwordRef.current = password;
      sessionStorage.setItem(SESSION_KEY, password);
      setIsAuthed(true);
    }
    return ok;
  }, []);

  const logout = useCallback(() => {
    passwordRef.current = null;
    sessionStorage.removeItem(SESSION_KEY);
    setIsAuthed(false);
  }, []);

  // Apply a change to the document and persist it. Rolls back on failure.
  const commit = useCallback(
    async (next: CalendarData) => {
      const password = passwordRef.current;
      if (password === null) throw new AuthError("Not signed in");
      const previous = data;
      setData(next); // optimistic
      setSaving(true);
      try {
        await saveData(next, password);
      } catch (err) {
        setData(previous); // roll back
        if (err instanceof AuthError) logout();
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [data, logout]
  );

  const saveEvent = useCallback(
    (event: CalendarEvent) => {
      const exists = data.events.some((e) => e.id === event.id);
      const events = exists
        ? data.events.map((e) => (e.id === event.id ? event : e))
        : [...data.events, event];
      return commit({ ...data, events });
    },
    [data, commit]
  );

  const deleteEvent = useCallback(
    (id: string) =>
      commit({ ...data, events: data.events.filter((e) => e.id !== id) }),
    [data, commit]
  );

  const saveCategory = useCallback(
    (category: Category) => {
      const exists = data.categories.some((c) => c.id === category.id);
      const categories = exists
        ? data.categories.map((c) => (c.id === category.id ? category : c))
        : [...data.categories, category];
      return commit({ ...data, categories });
    },
    [data, commit]
  );

  const deleteCategory = useCallback(
    (id: string) =>
      commit({
        ...data,
        categories: data.categories.filter((c) => c.id !== id),
        // Un-assign the category from any events that used it.
        events: data.events.map((e) =>
          e.categoryId === id ? { ...e, categoryId: null } : e
        ),
      }),
    [data, commit]
  );

  return {
    data,
    loading,
    error,
    saving,
    isAuthed,
    reload,
    login,
    logout,
    saveEvent,
    deleteEvent,
    saveCategory,
    deleteCategory,
  };
}
