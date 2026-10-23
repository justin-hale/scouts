import fs from 'node:fs';
import path from 'node:path';
import type { AppContext, PlatformConfig } from '../context.js';
import { now } from '../db.js';
import { sha256Buffer } from '../library/hash.js';
import { fileStem } from '../library/names.js';
import { getPlatform } from '../platforms.js';
import { unzipBuffer } from '../library/zip.js';
import { layoutProfile, normalizeGameKey, parseSavePath, renderSavePath, type ParsedSave, type SaveKey } from '../profiles/profiles.js';
import { isSafeRelative } from '../profiles/template.js';
import { decodeSave } from './formats.js';

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
      { $p: platform, $k: key.gameKey, $f: key.file, $g: this.gameIdFor(platform, key.gameKey, key.file) },
    );
    return this.getSave(lastId)!;
  }

  /** Which library game a save belongs to, from its game key (and, for memory cards, its file). */
  gameIdFor(platform: string, gameKey: string, file?: string): number | null {
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
    if (def.keyKind === 'card') {
      // A card holds many games, but each Dolphin GCI file belongs to one:
      // "01-GZLE-gczelda.gci" is maker 01, game code GZLE, i.e. disc ID GZLE01.
      const m = platform === 'gc' && file ? /^([0-9A-Z]{2})-([0-9A-Z]{4})-/i.exec(path.posix.basename(file)) : null;
      if (!m) return null;
      const discId = `${m[2]}${m[1]}`.toLowerCase();
      return db.get<{ id: number }>('SELECT id FROM games WHERE platform = $p AND title_id = $t', { $p: platform, $t: discId })?.id ?? null;
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
      const gameId = this.gameIdFor(s.platform, s.game_key, s.file);
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
      if (this.importData(pc.def.slug, key, data, 'Found in server save folder')) imported++;
    }
    return { imported };
  }

  /**
   * Pick up saves kept next to ROMs ("Mario Kart.v64" + "Mario Kart.srm"),
   * the way many people run emulators. A file counts when an emulator
   * profile recognises its name and a ROM with the same name sits in the same
   * folder. The ROM folder is left untouched; the save is versioned and
   * mirrored into the platform's save folder like any other.
   */
  importBesideRoms(pc: PlatformConfig, candidates: string[], romPaths: string[]): { imported: number } {
    if (pc.def.keyKind !== 'rom' || !pc.romPath) return { imported: 0 };
    const db = this.ctx.db;
    const romStems = new Set(romPaths.map((r) => `${path.posix.dirname(r)}/${fileStem(r)}`.toLowerCase()));
    let imported = 0;
    for (const rel of candidates) {
      const key = this.parseWithProfiles(pc, path.posix.basename(rel));
      if (!key || !romStems.has(`${path.posix.dirname(rel)}/${key.gameKey}`.toLowerCase())) continue;
      const data = decodeSave(key.format, fs.readFileSync(path.join(pc.romPath, rel)));
      const sha = sha256Buffer(data);
      const prev = db.get<{ sha256: string }>('SELECT sha256 FROM rom_folder_saves WHERE platform = $p AND rel_path = $r', {
        $p: pc.def.slug,
        $r: rel,
      });
      if (prev?.sha256 === sha) continue;
      if (this.importData(pc.def.slug, { gameKey: key.gameKey, file: key.file }, data, 'Found next to the ROM')) imported++;
      db.run(
        `INSERT INTO rom_folder_saves (platform, rel_path, sha256) VALUES ($p, $r, $sha)
         ON CONFLICT(platform, rel_path) DO UPDATE SET sha256 = excluded.sha256`,
        { $p: pc.def.slug, $r: rel, $sha: sha },
      );
    }
    return { imported };
  }

  /**
   * Store a save uploaded from the web GUI for one game. The upload's name
   * can be anything ("Pokemon Black 2 [2026-10-22].sav"); where it goes
   * depends on the platform:
   * - ROM-keyed: keyed by the game's ROM name; the extension (.sav, .srm,
   *   .dsv, _1.mcd ...) picks the file, via the emulator profiles.
   * - 3DS/Wii: a zip of the save folder ("data/00000001/main"), as Citra,
   *   Azahar and RomM export them.
   * - PSP: a zip of one or more SAVEDATA folders.
   * - GameCube: a .gci file, placed on memory card A of its region.
   * Returns the saves that changed. `note` labels the new versions in history.
   */
  importUpload(gameId: number, uploadName: string, data: Buffer, note = `Uploaded (${uploadName})`): SaveKey[] {
    const db = this.ctx.db;
    const game = db.get<{ platform: string; title_id: string | null }>('SELECT platform, title_id FROM games WHERE id = $id', { $id: gameId });
    if (!game) throw new UploadError('Game not found', 404);
    const pc = this.ctx.platform(game.platform)!;
    const def = pc.def;
    const ext = path.extname(uploadName).toLowerCase();
    const keys: { key: SaveKey; data: Buffer }[] = [];

    if (def.keyKind === 'rom') {
      const rom = db.get<{ stem: string }>('SELECT stem FROM roms WHERE game_id = $g ORDER BY missing, id LIMIT 1', { $g: gameId });
      if (!rom) throw new UploadError('This game has no ROM to name the save after');
      const parsed = this.parseWithProfiles(pc, path.posix.basename(uploadName.replace(/\\/g, '/')));
      const file = parsed?.file ?? (ext === '.sav' || ext === '.srm' ? 'battery.sav' : null);
      if (!file) throw new UploadError(`RomSafe doesn't know where a "${ext || uploadName}" save goes for ${def.name}`);
      // DeSmuME-style saves carry a footer whatever their extension; strip it so every DS emulator can load the save.
      const format = parsed?.format ?? (def.slug === 'nds' ? 'desmume-dsv' : undefined);
      keys.push({ key: { gameKey: rom.stem, file }, data: decodeSave(format, data) });
    } else if (def.keyKind === 'titleId') {
      if (!game.title_id) throw new UploadError('Set this game\'s title ID first (Edit on the game page)');
      if (ext !== '.zip') throw new UploadError(`Upload ${def.name} saves as a .zip of the save folder (the one with "data" inside)`);
      for (const entry of unzipUpload(data)) {
        // Everything below "data/" is the save; without one, take the zip's paths as they are.
        const at = entry.name.toLowerCase().lastIndexOf('data/');
        const file = at >= 0 ? entry.name.slice(at + 5) : entry.name;
        if (file && isSafeRelative(file)) keys.push({ key: { gameKey: game.title_id, file }, data: entry.data });
      }
    } else if (def.keyKind === 'saveDir') {
      if (ext !== '.zip') throw new UploadError(`Upload ${def.name} saves as a .zip of the SAVEDATA folder`);
      for (const entry of unzipUpload(data)) {
        const parts = entry.name.split('/');
        const at = parts.findIndex((p) => p.toUpperCase() === 'SAVEDATA');
        const rest = parts.slice(at + 1);
        if (rest.length < 2 || !isSafeRelative(rest.join('/'))) continue;
        keys.push({ key: { gameKey: rest[0]!, file: rest.slice(1).join('/') }, data: entry.data });
      }
    } else if (def.slug === 'gc' && ext === '.gci') {
      if (data.length < 0x40) throw new UploadError('Not a GCI file');
      const code = data.toString('latin1', 0, 4);
      const maker = data.toString('latin1', 4, 6);
      const name = data.toString('latin1', 8, 0x28).replace(/\0[\s\S]*$/, '').replace(/[\\/:*?"<>|]/g, '_');
      if (!/^[0-9A-Z]{4}$/.test(code) || !/^[0-9A-Z]{2}$/.test(maker) || !name) throw new UploadError('Not a GCI file');
      const region = { J: 'JAP', P: 'EUR' }[code[3]!] ?? 'USA';
      keys.push({ key: { gameKey: `${region}/A`, file: `${maker}-${code}-${name}.gci` }, data });
    } else {
      throw new UploadError(`Uploading ${def.name} saves isn't supported yet; sync them from a device or drop them in the save folder`);
    }

    if (keys.length === 0) throw new UploadError('No save files found in the upload');
    const changed: SaveKey[] = [];
    for (const { key, data } of keys) {
      key.gameKey = normalizeGameKey(def, key.gameKey);
      if (this.importData(def.slug, key, data, note)) changed.push(key);
    }
    return changed;
  }

  private parseWithProfiles(pc: PlatformConfig, fileName: string): ParsedSave | null {
    for (const profile of this.ctx.profiles) {
      const key = parseSavePath(profile, pc.def, fileName);
      if (key) return key;
    }
    return null;
  }

  /** Make `data` the current version of a save unless it already is. Returns true if a version was added. */
  private importData(platform: string, key: SaveKey, data: Buffer, note: string): boolean {
    const sha = sha256Buffer(data);
    return this.ctx.db.tx(() => {
      const save = this.findOrCreateSave(platform, key);
      const current = save.current_version_id ? this.getVersion(save.current_version_id) : undefined;
      if (current?.sha256 === sha) return false;
      this.addVersion(save, data, { note, makeCurrent: true });
      return true;
    });
  }
}

function unzipUpload(data: Buffer): { name: string; data: Buffer }[] {
  try {
    return unzipBuffer(data);
  } catch (err) {
    throw new UploadError(`Couldn't read the zip: ${(err as Error).message}`);
  }
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function writeAtomic(file: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.romsafe-${process.pid}-${Date.now()}.tmp`;
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
