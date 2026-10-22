export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('romsafe:unauthorized'));
    throw new ApiError(data?.error ?? res.statusText, res.status);
  }
  return data as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T>(url: string, body: unknown) => api<T>('PUT', url, body);
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);

export const coverUrl = (file: string | null) => (file ? `/api/covers/${file}` : null);

// --- shapes returned by the server -------------------------------------------

export interface Platform {
  slug: string;
  name: string;
  keyKind: 'rom' | 'titleId' | 'saveDir' | 'card';
  romExtensions: string[];
  enabled: boolean;
  romPath: string | null;
  savePath: string | null;
  saveLayout: string;
  saveLayoutOverride: string | null;
  defaultSaveLayout: string;
  profiles: string[];
  counts: { games: number; roms: number; saves: number };
}

export interface GameSummary {
  id: number;
  platform: string;
  title: string;
  releaseDate: string | null;
  cover: string | null;
  romCount: number;
  saveCount: number;
}

export interface GameDetail {
  id: number;
  platform: string;
  title: string;
  titleId: string | null;
  igdbId: number | null;
  sgdbId: number | null;
  summary: string | null;
  releaseDate: string | null;
  cover: string | null;
  metadataSource: string | null;
  roms: {
    id: number;
    relPath: string;
    fileName: string;
    size: number;
    crc32: string | null;
    md5: string | null;
    sha1: string | null;
    titleId: string | null;
    missing: number;
  }[];
  saves: SaveSummary[];
}

export interface SaveSummary {
  id: number;
  gameKey: string;
  file: string;
  currentVersionId: number | null;
  sha256: string | null;
  size: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
  versionCount: number;
}

export interface SaveListItem extends SaveSummary {
  platform: string;
  gameId: number | null;
  gameTitle: string | null;
}

export interface SaveVersion {
  id: number;
  sha256: string;
  size: number;
  createdAt: number;
  note: string | null;
  device: string | null;
  isCurrent: number;
}

export interface Candidate {
  provider: 'igdb' | 'steamgriddb';
  id: number;
  name: string;
  year?: number;
  summary?: string;
  coverUrl?: string;
}

export interface Device {
  id: number;
  name: string;
  kind: string;
  createdAt: number;
  lastSeenAt: number | null;
  mappings: number;
  queued: number;
}

export interface DeviceDetail {
  id: number;
  name: string;
  kind: string;
  createdAt: number;
  lastSeenAt: number | null;
  mappings: { platform: string; profile: string; saveRoot: string | null; romRoot: string | null }[];
  romSummary: { platform: string; files: number; matched: number }[];
}

export interface Conflict {
  id: number;
  saveId: number;
  createdAt: number;
  platform: string;
  file: string;
  gameKey: string;
  gameTitle: string | null;
  gameId: number | null;
  device: string | null;
  serverVersionId: number;
  serverSize: number;
  serverCreatedAt: number;
  deviceVersionId: number;
  deviceSize: number;
  deviceCreatedAt: number;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  platforms: string[];
  saves: { platforms: string[]; pattern: string; file?: string }[];
}

export interface Setting {
  key: string;
  label: string;
  secret: boolean;
  set: boolean;
  value: string | null;
}

export interface JobStatus {
  running: boolean;
  processed: number;
  total: number;
  errors: string[];
  platform?: string | null;
  added?: number;
  savesImported?: number;
  updated?: number;
}
