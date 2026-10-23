import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { pruneEmptyDirs, type SaveStore } from '../saves/store.js';
import { cueFiles, gdiFiles } from './sheets.js';

/** Hidden folder (the scanner skips dot folders) inside each ROM folder where deleted files go. */
export const TRASH_DIR = '.romsafe-trash';

interface RomRow {
  id: number;
  platform: string;
  game_id: number | null;
  rel_path: string;
  parts: string | null;
}

/**
 * Removing ROMs and games from the library. Files aren't erased: they move
 * to <ROM folder>/.romsafe-trash/<time>/, keeping their paths, so a slip can
 * be undone from the share. Empty that folder to free the space.
 */
export class LibraryRemover {
  constructor(
    private ctx: AppContext,
    private store: SaveStore,
  ) {}

  /** Delete one ROM file (and the tracks of a .cue/.gdi). If it was the game's last ROM, the game goes too; its saves stay. */
  deleteRom(romId: number): { gameDeleted: boolean } {
    const db = this.ctx.db;
    const rom = db.get<RomRow>('SELECT id, platform, game_id, rel_path, parts FROM roms WHERE id = $id', { $id: romId });
    if (!rom) throw Object.assign(new Error('ROM not found'), { statusCode: 404 });
    const stamp = trashStamp();
    this.trashRomFiles(rom, stamp);
    db.run('DELETE FROM roms WHERE id = $id', { $id: rom.id });
    const left = rom.game_id && db.get('SELECT 1 FROM roms WHERE game_id = $g LIMIT 1', { $g: rom.game_id });
    if (rom.game_id && !left) {
      this.removeGame(rom.game_id, stamp, false);
      return { gameDeleted: true };
    }
    return { gameDeleted: false };
  }

  /** Delete a game: all its ROM files and extras, and optionally its saves. */
  deleteGame(gameId: number, opts: { saves: boolean }): { roms: number; extras: number; saves: number } {
    const db = this.ctx.db;
    if (!db.get('SELECT 1 FROM games WHERE id = $id', { $id: gameId })) throw Object.assign(new Error('Game not found'), { statusCode: 404 });
    const stamp = trashStamp();
    const roms = db.all<RomRow>('SELECT id, platform, game_id, rel_path, parts FROM roms WHERE game_id = $g', { $g: gameId });
    for (const rom of roms) {
      this.trashRomFiles(rom, stamp);
      db.run('DELETE FROM roms WHERE id = $id', { $id: rom.id });
    }
    return { roms: roms.length, ...this.removeGame(gameId, stamp, opts.saves) };
  }

  /** Trash a game's extras, optionally delete its saves, then drop the game and its cover. */
  private removeGame(gameId: number, stamp: string, withSaves: boolean): { extras: number; saves: number } {
    const db = this.ctx.db;
    const extras = db.all<{ id: number; platform: string; rel_path: string }>('SELECT id, platform, rel_path FROM extras WHERE game_id = $g', {
      $g: gameId,
    });
    for (const x of extras) {
      const root = this.ctx.platform(x.platform)?.romPath;
      if (root) trash(root, x.rel_path, stamp);
      db.run('DELETE FROM extras WHERE id = $id', { $id: x.id });
    }
    let saves = 0;
    if (withSaves) {
      for (const { id } of db.all<{ id: number }>('SELECT id FROM saves WHERE game_id = $g', { $g: gameId })) {
        if (this.store.deleteSave(id)) saves++;
      }
    }
    const cover = db.get<{ cover_file: string | null }>('SELECT cover_file FROM games WHERE id = $id', { $id: gameId })?.cover_file;
    if (cover) fs.rmSync(path.join(this.ctx.coverDir, cover), { force: true });
    // Remaining saves keep their game key and show up as unmatched (game_id is set to NULL).
    db.run('DELETE FROM games WHERE id = $id', { $id: gameId });
    return { extras: extras.length, saves };
  }

  private trashRomFiles(rom: RomRow, stamp: string): void {
    const root = this.ctx.platform(rom.platform)?.romPath;
    if (!root) return;
    // The discs an .m3u lists are ROMs of their own; every other ROM's parts go with it.
    let parts: string[] = [];
    if (path.extname(rom.rel_path).toLowerCase() !== '.m3u') {
      parts = rom.parts ? (JSON.parse(rom.parts) as { path: string }[]).map((p) => p.path) : sheetTrackPaths(root, rom.rel_path);
    }
    for (const rel of [rom.rel_path, ...parts]) trash(root, rel, stamp);
  }
}

/** Track files listed by a .cue or .gdi, as paths relative to the ROM folder. */
function sheetTrackPaths(root: string, rel: string): string[] {
  const ext = path.extname(rel).toLowerCase();
  if (ext !== '.cue' && ext !== '.gdi') return [];
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, rel), 'latin1');
  } catch {
    return [];
  }
  const dir = path.posix.dirname(rel);
  return (ext === '.cue' ? cueFiles(text) : gdiFiles(text)).map((f) => path.posix.join(dir, f.replace(/\\/g, '/')));
}

/** Move a file into the trash, keeping its relative path, and remove folders it leaves empty. */
function trash(root: string, rel: string, stamp: string): void {
  const src = path.join(root, ...rel.split('/'));
  if (!fs.existsSync(src)) return;
  const dest = path.join(root, TRASH_DIR, stamp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.rmSync(src);
  }
  pruneEmptyDirs(path.dirname(src), root);
}

function trashStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
