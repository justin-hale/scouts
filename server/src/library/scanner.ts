import fs from 'node:fs';
import path from 'node:path';
import type { AppContext, PlatformConfig } from '../context.js';
import { now } from '../db.js';
import { SaveStore, walkFiles } from '../saves/store.js';
import { hashRom } from './hash.js';
import { read3dsTitleId } from './n3ds.js';
import { cleanTitle, fileStem } from './names.js';

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

    if (pc.romPath && fs.existsSync(pc.romPath)) {
      const exts = new Set(pc.def.romExtensions);
      const files = [...walkFiles(pc.romPath)].filter((f) => exts.has(path.extname(f).toLowerCase()));
      this.status.total += files.length;
      const seen = new Set<string>();

      for (const rel of files) {
        seen.add(rel);
        try {
          await this.scanRom(pc, rel);
        } catch (err) {
          this.status.errors.push(`${slug}/${rel}: ${(err as Error).message}`);
        }
        this.status.processed++;
      }

      const known = db.all<{ id: number; rel_path: string }>('SELECT id, rel_path FROM roms WHERE platform = $p', { $p: slug });
      for (const r of known) {
        const missing = seen.has(r.rel_path) ? 0 : 1;
        db.run('UPDATE roms SET missing = $m WHERE id = $id', { $m: missing, $id: r.id });
      }
    }

    this.status.savesImported += new SaveStore(this.ctx).importFromDisk(pc).imported;
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
    const titleId = slug === '3ds' ? await read3dsTitleId(abs).catch(() => null) : null;
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
