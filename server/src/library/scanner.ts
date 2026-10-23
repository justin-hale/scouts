import fs from 'node:fs';
import path from 'node:path';
import type { AppContext, PlatformConfig } from '../context.js';
import { now, type Db } from '../db.js';
import { getPlatform } from '../platforms.js';
import { SaveStore, walkFiles } from '../saves/store.js';
import { hashRom } from './hash.js';
import { parseDiscImage, readDiscId, wiiTitleId } from './disc.js';
import { parse3dsTitleId, read3dsTitleId } from './n3ds.js';
import { cleanTitle, fileStem } from './names.js';
import { sheetTracks } from './sheets.js';
import { readZipEntryHead } from './zip.js';

export interface ScanStatus {
  running: boolean;
  platform: string | null;
  processed: number;
  total: number;
  added: number;
  savesImported: number;
  startedAt: number | null;
  finishedAt: number | null;
  errors: string[];
}

interface RomRow {
  id: number;
  game_id: number | null;
  size: number;
  mtime: number;
  sha1: string | null;
}

/** Walks each platform's ROM folder, hashes new or changed files and groups them into games. */
export class Scanner {
  status: ScanStatus = {
    running: false,
    platform: null,
    processed: 0,
    total: 0,
    added: 0,
    savesImported: 0,
    startedAt: null,
    finishedAt: null,
    errors: [],
  };

  constructor(private ctx: AppContext) {}

  /** Start a scan in the background. Returns false if one is already running. */
  start(platforms?: string[]): boolean {
    if (this.status.running) return false;
    const targets = this.ctx.platforms().filter((p) => p.enabled && (!platforms || platforms.includes(p.def.slug)));
    this.status = {
      running: true,
      platform: null,
      processed: 0,
      total: 0,
      added: 0,
      savesImported: 0,
      startedAt: now(),
      finishedAt: null,
      errors: [],
    };
    void this.run(targets);
    return true;
  }

  async run(targets: PlatformConfig[]): Promise<void> {
    try {
      for (const pc of targets) {
        this.status.platform = pc.def.slug;
        try {
          await this.scanPlatform(pc);
        } catch (err) {
          this.status.errors.push(`${pc.def.slug}: ${(err as Error).message}`);
        }
      }
      new SaveStore(this.ctx).relinkSaves();
    } finally {
      this.status.running = false;
      this.status.platform = null;
      this.status.finishedAt = now();
    }
  }

  async scanPlatform(pc: PlatformConfig): Promise<void> {
    const db = this.ctx.db;
    const slug = pc.def.slug;

    const store = new SaveStore(this.ctx);
    if (pc.romPath && fs.existsSync(pc.romPath)) {
      const { roms, extras, other } = classifyFiles(pc.def.romExtensions, pc.romPath, [...walkFiles(pc.romPath)]);
      this.status.total += roms.length;

      for (const rel of roms) {
        try {
          await this.scanRom(pc, rel);
        } catch (err) {
          this.status.errors.push(`${slug}/${rel}: ${(err as Error).message}`);
        }
        this.status.processed++;
      }
      markMissing(db, 'roms', slug, new Set(roms));

      for (const extra of extras) this.indexExtra(pc, extra);
      markMissing(db, 'extras', slug, new Set(extras.map((e) => e.rel)));

      this.status.savesImported += store.importBesideRoms(pc, other, roms).imported;
    }

    this.status.savesImported += store.importFromDisk(pc).imported;
  }

  /** Record an extra and attach it to the game whose ROMs share its folder. */
  private indexExtra(pc: PlatformConfig, extra: ExtraFile): void {
    const db = this.ctx.db;
    const st = fs.statSync(path.join(pc.romPath!, extra.rel));
    let gameId: number | null = null;
    if (extra.owner) {
      gameId =
        db.get<{ game_id: number }>(
          `SELECT game_id FROM roms WHERE platform = $p AND missing = 0 AND game_id IS NOT NULL
             AND substr(rel_path, 1, length($dir) + 1) = $dir || '/' ORDER BY id LIMIT 1`,
          { $p: pc.def.slug, $dir: extra.owner },
        )?.game_id ??
        // No ROM in that folder: fall back to a game named like the folder. The
        // dummy extension stops cleanTitle eating "Mr. Driller" as "Mr".
        db.get<{ id: number }>('SELECT id FROM games WHERE platform = $p AND lower(title) = lower($t)', {
          $p: pc.def.slug,
          $t: cleanTitle(`${path.posix.basename(extra.owner)}.dir`),
        })?.id ??
        null;
    }
    db.run(
      `INSERT INTO extras (platform, game_id, kind, rel_path, file_name, size, mtime, missing)
       VALUES ($p, $g, $k, $r, $n, $size, $mtime, 0)
       ON CONFLICT(platform, rel_path) DO UPDATE SET game_id = excluded.game_id, kind = excluded.kind,
         size = excluded.size, mtime = excluded.mtime, missing = 0`,
      {
        $p: pc.def.slug,
        $g: gameId,
        $k: extra.kind,
        $r: extra.rel,
        $n: path.posix.basename(extra.rel),
        $size: st.size,
        $mtime: Math.floor(st.mtimeMs),
      },
    );
  }

  private async scanRom(pc: PlatformConfig, rel: string): Promise<void> {
    const db = this.ctx.db;
    const slug = pc.def.slug;
    const abs = path.join(pc.romPath!, rel);
    const st = fs.statSync(abs);
    const mtime = Math.floor(st.mtimeMs);
    const existing = db.get<RomRow>('SELECT id, game_id, size, mtime, sha1 FROM roms WHERE platform = $p AND rel_path = $r', {
      $p: slug,
      $r: rel,
    });
    if (existing && existing.size === st.size && existing.mtime === mtime && existing.sha1) {
      db.run('UPDATE roms SET missing = 0 WHERE id = $id', { $id: existing.id });
      return;
    }

    const hashes = await hashRom(abs);
    const titleId = await readTitleId(slug, abs);
    const fileName = path.posix.basename(rel);

    db.tx(() => {
      const gameId = existing?.game_id ?? this.findOrCreateGame(slug, cleanTitle(fileName), titleId);
      if (existing) {
        db.run(
          `UPDATE roms SET game_id = $g, size = $size, mtime = $mtime, crc32 = $crc, md5 = $md5, sha1 = $sha1,
             title_id = $tid, missing = 0 WHERE id = $id`,
          { $g: gameId, $size: st.size, $mtime: mtime, $crc: hashes.crc32, $md5: hashes.md5, $sha1: hashes.sha1, $tid: titleId, $id: existing.id },
        );
      } else {
        db.run(
          `INSERT INTO roms (platform, game_id, rel_path, file_name, stem, size, mtime, crc32, md5, sha1, title_id)
           VALUES ($p, $g, $rel, $name, $stem, $size, $mtime, $crc, $md5, $sha1, $tid)`,
          {
            $p: slug,
            $g: gameId,
            $rel: rel,
            $name: fileName,
            $stem: fileStem(fileName),
            $size: st.size,
            $mtime: mtime,
            $crc: hashes.crc32,
            $md5: hashes.md5,
            $sha1: hashes.sha1,
            $tid: titleId,
          },
        );
        this.status.added++;
      }
    });
  }

  private findOrCreateGame(platform: string, title: string, titleId: string | null): number {
    const db = this.ctx.db;
    if (titleId) {
      const byId = db.get<{ id: number }>('SELECT id FROM games WHERE platform = $p AND title_id = $t', { $p: platform, $t: titleId });
      if (byId) return byId.id;
    } else {
      const byTitle = db.get<{ id: number }>(
        'SELECT id FROM games WHERE platform = $p AND lower(title) = lower($t) AND title_id IS NULL',
        { $p: platform, $t: title },
      );
      if (byTitle) return byTitle.id;
    }
    return db.run(
      'INSERT INTO games (platform, title, title_id, created_at, updated_at) VALUES ($p, $t, $tid, $now, $now)',
      { $p: platform, $t: title, $tid: titleId, $now: now() },
    ).lastId;
  }
}

/**
 * RomM-style side folders. Anything below one of these (at any depth) is an
 * extra of the game whose folder holds it ("Zelda/mod/4k.zip"), or of the
 * whole platform when it sits at the top ("firmware/bios.bin").
 */
const EXTRA_DIRS: Record<string, string> = {
  dlc: 'dlc',
  hack: 'hack',
  hacks: 'hack',
  mod: 'mod',
  mods: 'mod',
  patch: 'patch',
  patches: 'patch',
  update: 'update',
  updates: 'update',
  demo: 'demo',
  manual: 'manual',
  manuals: 'manual',
  translation: 'translation',
  prototype: 'prototype',
  textures: 'texture',
  extras: 'extra',
  extra: 'extra',
  bios: 'firmware',
  firmware: 'firmware',
};

interface ExtraFile {
  rel: string;
  kind: string;
  /** Folder that owns the extra ("" for the platform itself). */
  owner: string;
}

/** Split a ROM folder's files into ROMs, extras, and everything else (candidate saves, readmes, ...). */
export function classifyFiles(romExtensions: string[], root: string, files: string[]) {
  const exts = new Set(romExtensions);
  const extras: ExtraFile[] = [];
  const rest: string[] = [];
  for (const rel of files) {
    const parts = rel.split('/');
    const at = parts.slice(0, -1).findIndex((p) => EXTRA_DIRS[p.toLowerCase()]);
    if (at >= 0) extras.push({ rel, kind: EXTRA_DIRS[parts[at]!.toLowerCase()]!, owner: parts.slice(0, at).join('/') });
    else rest.push(rel);
  }
  const tracks = sheetTracks(root, rest.filter((f) => exts.has(path.extname(f).toLowerCase())));
  const roms: string[] = [];
  const other: string[] = [];
  for (const rel of rest) {
    if (exts.has(path.extname(rel).toLowerCase()) && !tracks.has(rel.toLowerCase())) roms.push(rel);
    else other.push(rel);
  }
  return { roms, extras, other };
}

function markMissing(db: Db, table: 'roms' | 'extras', platform: string, seen: Set<string>): void {
  const known = db.all<{ id: number; rel_path: string }>(`SELECT id, rel_path FROM ${table} WHERE platform = $p`, { $p: platform });
  for (const r of known) {
    db.run(`UPDATE ${table} SET missing = $m WHERE id = $id`, { $m: seen.has(r.rel_path) ? 0 : 1, $id: r.id });
  }
}

/** Platform-native ID used to group discs into games and link title-keyed saves. */
async function readTitleId(platform: string, file: string): Promise<string | null> {
  try {
    const zipped = path.extname(file).toLowerCase() === '.zip';
    if (platform === '3ds') {
      if (!zipped) return await read3dsTitleId(file);
      const entry = await readZipEntryHead(file, innerExts(platform), 0x200);
      return entry ? parse3dsTitleId(entry.head) : null;
    }
    if (platform === 'gc' || platform === 'wii') {
      let disc;
      if (!zipped) disc = await readDiscId(file);
      else {
        const entry = await readZipEntryHead(file, innerExts(platform), 0x300);
        disc = entry ? parseDiscImage(entry.head) : null;
      }
      if (!disc) return null;
      return disc.system === 'wii' ? wiiTitleId(disc.gameId) : disc.gameId.toLowerCase();
    }
  } catch {
    // Unreadable header: fall back to grouping by file name.
  }
  return null;
}

/** ROM extensions to look for inside an archive (archives themselves excluded). */
function innerExts(platform: string): Set<string> {
  return new Set((getPlatform(platform)?.romExtensions ?? []).filter((e) => e !== '.zip' && e !== '.7z'));
}
