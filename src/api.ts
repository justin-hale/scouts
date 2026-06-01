import type { CalendarData } from "./types";
import { sampleData } from "./data/sampleData";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD || "scouts";
const LS_KEY = "scouts-calendar-data";

/** True when a real backend (Cloudflare Worker) is configured. */
export const hasBackend = API_BASE !== "";

export class AuthError extends Error {}

function normalize(data: Partial<CalendarData> | null): CalendarData {
  return {
    categories: data?.categories ?? [],
    events: data?.events ?? [],
  };
}

// --- localStorage fallback (used when no Worker is configured) ---

function readLocal(): CalendarData {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    localStorage.setItem(LS_KEY, JSON.stringify(sampleData));
    return structuredClone(sampleData);
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return structuredClone(sampleData);
  }
}

function writeLocal(data: CalendarData): void {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// --- public API ---

export async function fetchData(): Promise<CalendarData> {
  if (!hasBackend) return readLocal();

  const res = await fetch(`${API_BASE}/`, { method: "GET" });
  if (!res.ok) throw new Error(`Failed to load calendar (${res.status})`);
  return normalize(await res.json());
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!hasBackend) return password === DEV_PASSWORD;

  const res = await fetch(`${API_BASE}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

export async function saveData(
  data: CalendarData,
  password: string
): Promise<void> {
  if (!hasBackend) {
    if (password !== DEV_PASSWORD) throw new AuthError("Incorrect password");
    writeLocal(data);
    return;
  }

  const res = await fetch(`${API_BASE}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, data }),
  });
  if (res.status === 401) throw new AuthError("Incorrect password");
  if (!res.ok) throw new Error(`Failed to save (${res.status})`);
}
