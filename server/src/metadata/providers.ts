import type { Db } from '../db.js';
import { getSetting } from '../settings.js';

export interface Candidate {
  provider: 'igdb' | 'steamgriddb';
  id: number;
  name: string;
  year?: number;
  summary?: string;
  coverUrl?: string;
}

const UA = 'RomSafe/0.1';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init?.headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return (await res.json()) as T;
}

// --- IGDB (needs a free Twitch developer app) -------------------------------

let igdbToken: { value: string; expiresAt: number; clientId: string } | null = null;

async function igdbAuth(db: Db): Promise<{ clientId: string; token: string } | null> {
  const clientId = getSetting(db, 'igdb_client_id');
  const secret = getSetting(db, 'igdb_client_secret');
  if (!clientId || !secret) return null;
  if (igdbToken && igdbToken.clientId === clientId && igdbToken.expiresAt > Date.now() + 60_000) {
    return { clientId, token: igdbToken.value };
  }
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`;
  const body = await getJson<{ access_token: string; expires_in: number }>(url, { method: 'POST' });
  igdbToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, clientId };
  return { clientId, token: body.access_token };
}

interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id: string };
}

export async function igdbSearch(db: Db, query: string, igdbPlatformId?: number): Promise<Candidate[] | null> {
  const auth = await igdbAuth(db);
  if (!auth) return null;
  const q = query.replace(/"/g, '');
  const where = igdbPlatformId ? ` where platforms = (${igdbPlatformId});` : '';
  const body = `search "${q}"; fields name,summary,first_release_date,cover.image_id;${where} limit 10;`;
  const games = await getJson<IgdbGame[]>('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
    body,
  });
  return games.map((g) => ({
    provider: 'igdb',
    id: g.id,
    name: g.name,
    summary: g.summary,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
    coverUrl: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : undefined,
  }));
}

export async function igdbGame(db: Db, id: number): Promise<Candidate | null> {
  const auth = await igdbAuth(db);
  if (!auth) return null;
  const games = await getJson<IgdbGame[]>('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
    body: `fields name,summary,first_release_date,cover.image_id; where id = ${Math.trunc(id)};`,
  });
  const g = games[0];
  if (!g) return null;
  return {
    provider: 'igdb',
    id: g.id,
    name: g.name,
    summary: g.summary,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
    coverUrl: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : undefined,
  };
}

// --- SteamGridDB (cover art, needs an API key) ------------------------------

interface SgdbResponse<T> {
  success: boolean;
  data: T;
}

export async function sgdbSearch(db: Db, query: string): Promise<Candidate[] | null> {
  const key = getSetting(db, 'steamgriddb_api_key');
  if (!key) return null;
  const res = await getJson<SgdbResponse<{ id: number; name: string; release_date?: number }[]>>(
    `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  return res.data.map((g) => ({
    provider: 'steamgriddb',
    id: g.id,
    name: g.name,
    year: g.release_date ? new Date(g.release_date * 1000).getUTCFullYear() : undefined,
  }));
}

export async function sgdbCover(db: Db, sgdbId: number): Promise<string | null> {
  const key = getSetting(db, 'steamgriddb_api_key');
  if (!key) return null;
  const res = await getJson<SgdbResponse<{ url: string }[]>>(
    `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900,342x482,660x930&types=static`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  return res.data[0]?.url ?? null;
}

export interface SgdbGrid {
  url: string;
  thumb: string;
  width: number;
  height: number;
}

/** Every static portrait cover SteamGridDB has for a game, most popular first. */
export async function sgdbGrids(db: Db, sgdbId: number): Promise<SgdbGrid[] | null> {
  const key = getSetting(db, 'steamgriddb_api_key');
  if (!key) return null;
  const res = await getJson<SgdbResponse<SgdbGrid[]>>(
    `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900,342x482,660x930&types=static`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  return res.data.map(({ url, thumb, width, height }) => ({ url, thumb, width, height }));
}

// --- libretro thumbnails (no key; matched by No-Intro/Redump file name) -----

export function libretroBoxartUrl(system: string, romStem: string): string {
  const name = romStem.replace(/[&*/:`<>?\\|"]/g, '_');
  return `https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/${encodeURIComponent(name)}.png`;
}

export async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Hosts cover art may be downloaded from, so the picker can't be used to make the server fetch arbitrary URLs. */
export const COVER_HOSTS = ['images.igdb.com', 'cdn2.steamgriddb.com', 'cdn.steamgriddb.com', 'thumbnails.libretro.com'];

export async function download(url: string): Promise<{ data: Buffer; contentType: string } | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) return null;
  return { data: Buffer.from(await res.arrayBuffer()), contentType };
}
