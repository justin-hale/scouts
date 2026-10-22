import fs from 'node:fs';
import path from 'node:path';
import type { AppContext, PlatformConfig } from '../context.js';
import { now } from '../db.js';
import { sha256Buffer } from '../library/hash.js';
import { getPlatform } from '../platforms.js';
import { layoutProfile, normalizeGameKey, parseSavePath, renderSavePath, type SaveKey } from '../profiles/profiles.js';

export interface SaveRow {
  id: number;
  platform: string;
  game_key: string;
  file: string;
  game_id: number | null;
  current_version_id: number | null;
}

export interface VersionRow {
  id: number;
  save_id: number;
  sha256: string;
  size: number;
  device_id: number | null;
  parent_version_id: number | null;
  note: string | null;
  created_at: number;
}

/**
 * Save files are stored once per content hash under data/blobs, which gives
 * every save a full version history. The current version of each save is
 * also mirrored into the platform's save folder using its save layout, so
 * the folder you mapped (e.g. ~/saves/3ds) always holds plain, usable files.
 */
export class SaveStore {
  constructor(private ctx: AppContext) {}

  blobPath(sha: string): string {
    return path.join(this.ctx.blobDir, sha.slice(0, 2), sha);
  }

  putBlob(data: Buffer): string {
    const sha = sha256Buffer(data);
    const file = this.blobPath(sha);
    if (!fs.existsSync(file)) writeAtomic(file, data);
    return sha;
  }

  getSave(id: number): SaveRow | undefined {
    return this.ctx.db.get<SaveRow>('SELECT * FROM saves WHERE id = $id', { $id: id });
  }

  getVersion(id: number): VersionRow | undefined {
    return this.ctx.db.get<VersionRow>('SELECT * FROM save_versions WHERE id = $id', { $id: id });
  }

  findSave(platform: string, key: SaveKey): SaveRow | undefined {
    return this.ctx.db.get<SaveRow>('SELECT * FROM saves WHERE platform = $p AND game_key = $k AND file = $f', {
      $p: platform,
      $k: key.gameKey,
      $f: key.file,
    });
  }

  findOrCreateSave(platform: string, key: SaveKey): SaveRow {
    const existing = this.findSave(platform, key);
    if (existing) return existing;
    const { lastId } = this.ctx.db.run(
      'INSERT INTO saves (platform, game_key, file, game_id) VALUES ($p, $k, $f, $g)',
      { $p: platform, $k: key.gameKey, $f: key.file, $g: this.gameIdFor(platform, key.gameKey) },
    );
    return this.getSave(lastId)!;
  }

  /** Which library game a save belongs to, from its game key. */
  gameIdFor(platform: string, gameKey: string): number | null {
    const def = getPlatform(platform);
    if (!def) return null;
    const db = this.ctx.db;
    if (def.keyKind === 'rom') {
      return (
        db.get<{ game_id: number | null }>(
          'SELECT game_id FROM roms WHERE platform = $p AND stem = $s AND game_id IS NOT NULL ORDER BY missing, id LIMIT 1',
          { $p: platform, $s: gameKey },
        )?.game_id ?? null
      );
    }
    if (def.keyKind === 'titleId') {
      return db.get<{ id: number }>('SELECT id FROM games WHERE platform = $p AND title_id = $t', { $p: platform, $t: gameKey })?.id ?? null;
    }
    // saveDir: PSP folders start with the game's serial (ULUS10336DATA00).
    return (
      db.get<{ id: number }>(
        "SELECT id FROM games WHERE platform = $p AND title_id IS NOT NULL AND $k LIKE title_id || '%' LIMIT 1",
        { $p: platform, $k: gameKey },
      )?.id ?? null
    );
  }

  /** Re-link saves that were created before their game was scanned. */
  relinkSaves(): void {
    const unlinked = this.ctx.db.all<SaveRow>('SELECT * FROM saves WHERE game_id IS NULL');
    for (const s of unlinked) {
      const gameId = this.gameIdFor(s.platform, s.game_key);
      if (gameId) this.ctx.db.run('UPDATE saves SET game_id = $g WHERE id = $id', { $g: gameId, $id: s.id });
    }
  }

  addVersion(
    save: SaveRow,
    data: Buffer,
    opts: { deviceId?: number | null; note?: string; makeCurrent: boolean; parentVersionId?: number | null },
  ): VersionRow {
    const sha = this.putBlob(data);
    const { lastId } = this.ctx.db.run(
      `INSERT INTO save_versions (save_id, sha256, size, device_id, parent_version_id, note, created_at)
       VALUES ($s, $sha, $size, $d, $parent, $note, $t)`,
      {
        $s: save.id,
        $sha: sha,
        $size: data.length,
        $d: opts.deviceId ?? null,
        $parent: opts.parentVersionId ?? save.current_version_id,
        $note: opts.note ?? null,
        $t: now(),
      },
    );
    if (opts.makeCurrent) this.setCurrent(save.id, lastId);
    return this.getVersion(lastId)!;
  }

  setCurrent(saveId: number, versionId: number): void {
    this.ctx.db.run('UPDATE saves SET current_version_id = $v WHERE id = $id', { $v: versionId, $id: saveId });
    this.mirror(saveId);
  }

  /** Path of a save inside the platform's server save folder, if one is configured. */
  serverPath(save: SaveRow): string | null {
    const pc = this.ctx.platform(save.platform);
    if (!pc?.savePath) return null;
    const rel = renderSavePath(layoutProfile(pc.def, pc.saveLayout), pc.def, { gameKey: save.game_key, file: save.file });
    return rel ? path.join(pc.savePath, ...rel.split('/')) : null;
  }

  mirror(saveId: number): void {
    const save = this.getSave(saveId);
    if (!save?.current_version_id) return;
    const target = this.serverPath(save);
    if (!target) return;
    const version = this.getVersion(save.current_version_id)!;
    writeAtomic(target, fs.readFileSync(this.blobPath(version.sha256)));
  }

  /**
   * Pick up saves placed directly in a platform's save folder on the server
   * (existing backups, or files edited by hand). Each file whose content
   * differs from the current version becomes the new current version.
   */
  importFromDisk(pc: PlatformConfig): { imported: number } {
    if (!pc.savePath || !fs.existsSync(pc.savePath)) return { imported: 0 };
    const layout = layoutProfile(pc.def, pc.saveLayout);
    let imported = 0;
    for (const rel of walkFiles(pc.savePath)) {
      const key = parseSavePath(layout, pc.def, rel);
      if (!key) continue;
      key.gameKey = normalizeGameKey(pc.def, key.gameKey);
      const data = fs.readFileSync(path.join(pc.savePath, rel));
      const sha = sha256Buffer(data);
      this.ctx.db.tx(() => {
        const save = this.findOrCreateSave(pc.def.slug, key);
        const current = save.current_version_id ? this.getVersion(save.current_version_id) : undefined;
        if (current?.sha256 === sha) return;
        this.addVersion(save, data, { note: 'Found in server save folder', makeCurrent: true });
        imported++;
      });
    }
    return { imported };
  }
}

export function writeAtomic(file: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.bonfire-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Relative paths (with "/") of all regular files below a directory, skipping dotfiles. */
export function* walkFiles(root: string, rel = ''): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkFiles(root, child);
    else if (e.isFile()) yield child;
  }
}
