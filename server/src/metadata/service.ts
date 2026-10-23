import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { now } from '../db.js';
import { titleKey } from '../library/names.js';
import { getPlatform } from '../platforms.js';
import { writeAtomic } from '../saves/store.js';
import {
  COVER_HOSTS,
  download,
  igdbGame,
  igdbSearch,
  libretroBoxartUrl,
  sgdbCover,
  sgdbGrids,
  sgdbSearch,
  urlExists,
  type Candidate,
} from './providers.js';

interface GameRow {
  id: number;
  platform: string;
  title: string;
  igdb_id: number | null;
  sgdb_id: number | null;
  cover_file: string | null;
}

export interface ScrapeStatus {
  running: boolean;
  processed: number;
  total: number;
  updated: number;
  errors: string[];
}

export class MetadataService {
  scrape: ScrapeStatus = { running: false, processed: 0, total: 0, updated: 0, errors: [] };

  constructor(private ctx: AppContext) {}

  private game(id: number): GameRow {
    const g = this.ctx.db.get<GameRow>('SELECT id, platform, title, igdb_id, sgdb_id, cover_file FROM games WHERE id = $id', { $id: id });
    if (!g) throw new Error('Game not found');
    return g;
  }

  async search(gameId: number, query?: string): Promise<{ candidates: Candidate[]; providers: string[] }> {
    const g = this.game(gameId);
    const q = query?.trim() || g.title;
    const platform = getPlatform(g.platform);
    const [igdb, sgdb] = await Promise.all([igdbSearch(this.ctx.db, q, platform?.igdbPlatformId), sgdbSearch(this.ctx.db, q)]);
    const providers = [igdb && 'igdb', sgdb && 'steamgriddb'].filter(Boolean) as string[];
    return { candidates: [...(igdb ?? []), ...(sgdb ?? [])], providers };
  }

  /** Apply a search result picked by the user. */
  async apply(gameId: number, provider: Candidate['provider'], id: number): Promise<void> {
    const g = this.game(gameId);
    if (provider === 'igdb') {
      const c = await igdbGame(this.ctx.db, id);
      if (!c) throw new Error('IGDB is not configured or the game was not found');
      const cover = c.coverUrl ? await this.saveCover(g, c.coverUrl) : null;
      this.ctx.db.run(
        `UPDATE games SET title = $t, igdb_id = $id, summary = $s, release_date = $r,
           cover_file = COALESCE($c, cover_file), metadata_source = 'igdb', updated_at = $now WHERE id = $g`,
        { $t: c.name, $id: c.id, $s: c.summary ?? null, $r: c.year ? String(c.year) : null, $c: cover, $now: now(), $g: g.id },
      );
    } else {
      const url = await sgdbCover(this.ctx.db, id);
      const cover = url ? await this.saveCover(g, url) : null;
      this.ctx.db.run('UPDATE games SET sgdb_id = $id, cover_file = COALESCE($c, cover_file), updated_at = $now WHERE id = $g', {
        $id: id,
        $c: cover,
        $now: now(),
        $g: g.id,
      });
    }
  }

  /**
   * Cover choices for the picker: IGDB's cover for each matching game,
   * every SteamGridDB grid for the best matches, and libretro box art for
   * each of the game's ROM names (when it exists).
   */
  async coverOptions(gameId: number, query?: string): Promise<{ covers: CoverOption[]; providers: string[] }> {
    const g = this.game(gameId);
    const q = query?.trim() || g.title;
    const platform = getPlatform(g.platform);
    const db = this.ctx.db;

    const igdbP = (async (): Promise<CoverOption[] | null> => {
      const found = await igdbSearch(db, q, platform?.igdbPlatformId);
      if (!found) return null;
      if (g.igdb_id && !found.some((c) => c.id === g.igdb_id)) {
        const current = await igdbGame(db, g.igdb_id);
        if (current) found.unshift(current);
      }
      return found
        .filter((c) => c.coverUrl)
        .map((c) => ({
          provider: 'igdb' as const,
          url: c.coverUrl!,
          thumb: c.coverUrl!.replace('t_cover_big_2x', 't_cover_big'),
          label: c.year ? `${c.name} (${c.year})` : c.name,
        }));
    })();

    const sgdbP = (async (): Promise<CoverOption[] | null> => {
      const matches = await sgdbSearch(db, q);
      if (!matches) return null;
      const games = g.sgdb_id ? [{ id: g.sgdb_id, name: g.title }, ...matches.filter((m) => m.id !== g.sgdb_id)] : matches;
      const grids = await Promise.all(games.slice(0, 3).map((m) => sgdbGrids(db, m.id).catch(() => [])));
      return games.slice(0, 3).flatMap((m, i) =>
        (grids[i] ?? []).slice(0, 24).map((grid) => ({
          provider: 'steamgriddb' as const,
          url: grid.url,
          thumb: grid.thumb,
          label: `${m.name} · ${grid.width}×${grid.height}`,
        })),
      );
    })();

    const libretroP = (async (): Promise<CoverOption[]> => {
      if (!platform?.libretroName) return [];
      const stems = db.all<{ stem: string }>('SELECT DISTINCT stem FROM roms WHERE game_id = $g ORDER BY missing, id LIMIT 5', { $g: g.id });
      const urls = stems.map(({ stem }) => ({ stem, url: libretroBoxartUrl(platform.libretroName!, stem) }));
      const ok = await Promise.all(urls.map((u) => urlExists(u.url)));
      return urls.filter((_, i) => ok[i]).map((u) => ({ provider: 'libretro' as const, url: u.url, thumb: u.url, label: u.stem }));
    })();

    const [igdb, sgdb, libretro] = await Promise.all([igdbP.catch(() => null), sgdbP.catch(() => null), libretroP]);
    const providers = [igdb && 'igdb', sgdb && 'steamgriddb', 'libretro'].filter(Boolean) as string[];
    return { covers: [...(igdb ?? []), ...(sgdb ?? []), ...libretro], providers };
  }

  /** Use a cover the user picked. Only the providers' image hosts are allowed. */
  async setCoverFromUrl(gameId: number, url: string): Promise<void> {
    const g = this.game(gameId);
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw Object.assign(new Error('Bad cover URL'), { statusCode: 400 });
    }
    if (!COVER_HOSTS.includes(host)) throw Object.assign(new Error(`Covers can't come from ${host}`), { statusCode: 400 });
    const file = await this.saveCover(g, url);
    if (!file) throw Object.assign(new Error('Could not download that image'), { statusCode: 502 });
    this.ctx.db.run('UPDATE games SET cover_file = $c, updated_at = $now WHERE id = $g', { $c: file, $now: now(), $g: g.id });
  }

  /** Use an image uploaded from the user's computer. */
  async setCoverFromUpload(gameId: number, data: Buffer): Promise<void> {
    const g = this.game(gameId);
    const ext = imageExt(data);
    if (!ext) throw Object.assign(new Error('Upload a PNG, JPEG or WebP image'), { statusCode: 400 });
    const file = this.storeCover(g, data, ext);
    this.ctx.db.run('UPDATE games SET cover_file = $c, updated_at = $now WHERE id = $g', { $c: file, $now: now(), $g: g.id });
  }

  /**
   * Best-effort automatic match: IGDB for metadata when the top result's
   * title matches, then cover art from IGDB, libretro thumbnails (by ROM
   * file name) or SteamGridDB, in that order.
   */
  async auto(gameId: number): Promise<boolean> {
    const g = this.game(gameId);
    let changed = false;
    const platform = getPlatform(g.platform);

    if (!g.igdb_id) {
      const results = await igdbSearch(this.ctx.db, g.title, platform?.igdbPlatformId);
      const want = titleKey(g.title);
      const hit = results?.find((c) => titleKey(c.name) === want) ?? (results?.length === 1 ? results[0] : undefined);
      if (hit) {
        await this.apply(g.id, 'igdb', hit.id);
        changed = true;
      }
    }

    if (!this.game(g.id).cover_file && platform?.libretroName) {
      const stems = this.ctx.db.all<{ stem: string }>('SELECT stem FROM roms WHERE game_id = $g ORDER BY missing, id', { $g: g.id });
      for (const { stem } of stems) {
        const file = await this.saveCover(g, libretroBoxartUrl(platform.libretroName, stem));
        if (file) {
          this.ctx.db.run('UPDATE games SET cover_file = $c, updated_at = $now WHERE id = $g', { $c: file, $now: now(), $g: g.id });
          changed = true;
          break;
        }
      }
    }

    if (!this.game(g.id).cover_file) {
      const results = await sgdbSearch(this.ctx.db, g.title);
      const hit = results?.find((c) => titleKey(c.name) === titleKey(g.title));
      if (hit) {
        await this.apply(g.id, 'steamgriddb', hit.id);
        changed = !!this.game(g.id).cover_file || changed;
      }
    }
    return changed;
  }

  /** Auto-scrape every game missing metadata or art, in the background. */
  startScrapeAll(platform?: string, force = false): boolean {
    if (this.scrape.running) return false;
    const where = [platform ? 'platform = $p' : '1=1', force ? '1=1' : '(cover_file IS NULL OR igdb_id IS NULL)'].join(' AND ');
    const ids = this.ctx.db.all<{ id: number }>(`SELECT id FROM games WHERE ${where} ORDER BY id`, platform ? { $p: platform } : {});
    this.scrape = { running: true, processed: 0, total: ids.length, updated: 0, errors: [] };
    void (async () => {
      for (const { id } of ids) {
        try {
          if (await this.auto(id)) this.scrape.updated++;
        } catch (err) {
          this.scrape.errors.push(`game ${id}: ${(err as Error).message}`);
        }
        this.scrape.processed++;
      }
      this.scrape.running = false;
    })();
    return true;
  }

  private async saveCover(g: GameRow, url: string): Promise<string | null> {
    const img = await download(url).catch(() => null);
    if (!img) return null;
    const ext = img.contentType.includes('png') ? '.png' : img.contentType.includes('webp') ? '.webp' : '.jpg';
    return this.storeCover(g, img.data, ext);
  }

  private storeCover(g: GameRow, data: Buffer, ext: string): string {
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
    const name = `${g.id}-${hash}${ext}`;
    writeAtomic(path.join(this.ctx.coverDir, name), data);
    if (g.cover_file && g.cover_file !== name) fs.rmSync(path.join(this.ctx.coverDir, g.cover_file), { force: true });
    return name;
  }
}

export interface CoverOption {
  provider: 'igdb' | 'steamgriddb' | 'libretro';
  /** Full-size image the server downloads when picked. */
  url: string;
  /** Smaller preview for the picker grid. */
  thumb: string;
  label: string;
}

function imageExt(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}
