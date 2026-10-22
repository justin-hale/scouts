import type { Db } from '../db.js';
import { cleanTitle, fileStem, titleKey } from '../library/names.js';
import { normalizePath } from '../profiles/template.js';

export interface InventoryFile {
  /** Path relative to the device's ROM folder for this platform. */
  path: string;
  size: number;
  sha1?: string;
}

export type MatchKind = 'hash' | 'name' | 'title' | 'manual' | 'none';

interface RomLite {
  id: number;
  stem: string;
  size: number;
  sha1: string | null;
}

interface DeviceRomRow {
  id: number;
  local_path: string;
  size: number;
  rom_id: number | null;
  match_kind: MatchKind;
}

/**
 * Work out which server ROM a device's local file is. Strongest evidence
 * wins: identical SHA-1, then same file name and size, then the same
 * cleaned-up title when that title is unambiguous.
 */
export function matchRom(roms: RomLite[], file: InventoryFile): { romId: number | null; kind: MatchKind } {
  if (file.sha1) {
    const sha = file.sha1.toLowerCase();
    const hit = roms.find((r) => r.sha1 === sha);
    if (hit) return { romId: hit.id, kind: 'hash' };
  }
  const stem = fileStem(file.path).toLowerCase();
  const byName = roms.filter((r) => r.stem.toLowerCase() === stem);
  const sized = byName.find((r) => r.size === file.size);
  if (sized) return { romId: sized.id, kind: 'name' };
  if (byName.length === 1) return { romId: byName[0]!.id, kind: 'name' };
  const key = titleKey(cleanTitle(file.path));
  const byTitle = roms.filter((r) => titleKey(cleanTitle(r.stem)) === key);
  if (byTitle.length === 1) return { romId: byTitle[0]!.id, kind: 'title' };
  return { romId: null, kind: 'none' };
}

/**
 * Record what ROMs a device has for one platform. With `complete`, files
 * the device no longer reports are forgotten. Manual matches made in the
 * web GUI survive as long as the file is unchanged.
 */
export function updateInventory(db: Db, deviceId: number, platform: string, files: InventoryFile[], complete: boolean) {
  const roms = db.all<RomLite>('SELECT id, stem, size, sha1 FROM roms WHERE platform = $p AND missing = 0', { $p: platform });
  const existing = new Map(
    db
      .all<DeviceRomRow>('SELECT id, local_path, size, rom_id, match_kind FROM device_roms WHERE device_id = $d AND platform = $p', {
        $d: deviceId,
        $p: platform,
      })
      .map((r) => [r.local_path, r]),
  );

  return db.tx(() => {
    const seen = new Set<string>();
    const results: { path: string; romId: number | null; match: MatchKind }[] = [];
    for (const f of files) {
      const localPath = normalizePath(f.path);
      seen.add(localPath);
      const prev = existing.get(localPath);
      const m =
        prev?.match_kind === 'manual' && prev.size === f.size ? { romId: prev.rom_id, kind: 'manual' as const } : matchRom(roms, f);
      db.run(
        `INSERT INTO device_roms (device_id, platform, local_path, stem, size, sha1, rom_id, match_kind)
         VALUES ($d, $p, $path, $stem, $size, $sha1, $rom, $kind)
         ON CONFLICT(device_id, platform, local_path) DO UPDATE SET
           stem = excluded.stem, size = excluded.size, sha1 = excluded.sha1,
           rom_id = excluded.rom_id, match_kind = excluded.match_kind`,
        {
          $d: deviceId,
          $p: platform,
          $path: localPath,
          $stem: fileStem(localPath),
          $size: f.size,
          $sha1: f.sha1?.toLowerCase() ?? null,
          $rom: m.romId,
          $kind: m.kind,
        },
      );
      if (m.romId) db.run('DELETE FROM device_rom_queue WHERE device_id = $d AND rom_id = $r', { $d: deviceId, $r: m.romId });
      results.push({ path: localPath, romId: m.romId, match: m.kind });
    }
    if (complete) {
      for (const [localPath, row] of existing) {
        if (!seen.has(localPath)) db.run('DELETE FROM device_roms WHERE id = $id', { $id: row.id });
      }
    }
    return results;
  });
}

export function setManualMatch(db: Db, deviceId: number, deviceRomId: number, romId: number | null): boolean {
  const { changes } = db.run(
    `UPDATE device_roms SET rom_id = $r, match_kind = $k WHERE id = $id AND device_id = $d`,
    { $r: romId, $k: romId ? 'manual' : 'none', $id: deviceRomId, $d: deviceId },
  );
  return changes > 0;
}

/** The server ROM stem a device's local ROM stem corresponds to (for ROM-named saves). */
export function serverStemForLocal(db: Db, deviceId: number, platform: string, localStem: string): string | null {
  return (
    db.get<{ stem: string }>(
      `SELECT r.stem FROM device_roms d JOIN roms r ON r.id = d.rom_id
       WHERE d.device_id = $d AND d.platform = $p AND d.stem = $s LIMIT 1`,
      { $d: deviceId, $p: platform, $s: localStem },
    )?.stem ?? null
  );
}

/** The device's local ROM stem for a server ROM stem, if the device has that ROM. */
export function localStemForServer(db: Db, deviceId: number, platform: string, serverStem: string): string | null {
  return (
    db.get<{ stem: string }>(
      `SELECT d.stem FROM device_roms d JOIN roms r ON r.id = d.rom_id
       WHERE d.device_id = $d AND d.platform = $p AND r.stem = $s LIMIT 1`,
      { $d: deviceId, $p: platform, $s: serverStem },
    )?.stem ?? null
  );
}
