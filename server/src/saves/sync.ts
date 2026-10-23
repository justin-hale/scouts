import type { AppContext } from '../context.js';
import { now } from '../db.js';
import { sha256Buffer } from '../library/hash.js';
import type { PlatformDef } from '../platforms.js';
import { parseSavePath, renderSavePath, type ParsedSave, type Profile } from '../profiles/profiles.js';
import { normalizePath } from '../profiles/template.js';
import { localStemForServer, serverStemForLocal } from '../roms/matching.js';
import { isEmptySave } from './content.js';
import { decodeSave } from './formats.js';
import { SaveStore, type SaveRow } from './store.js';

/** A save file as the device sees it, relative to the platform's mapped save folder. */
export interface LocalSave {
  path: string;
  sha256: string;
  size: number;
}

export type SyncAction =
  | { action: 'ok'; path: string; saveId: number; versionId: number }
  | { action: 'upload'; path: string; baseVersionId: number | null }
  | { action: 'download'; path: string; saveId: number; versionId: number; sha256: string; size: number }
  | { action: 'conflict'; path: string; saveId: number; serverVersionId: number; baseVersionId: number | null }
  | { action: 'pending-conflict'; path: string; saveId: number; conflictId: number }
  | { action: 'unrecognized'; path: string }
  | { action: 'empty'; path: string }
  | { action: 'deleted'; path: string };

export interface UploadResult {
  /** 'empty': held no game data, kept in history only. 'deleted': a save deleted in the GUI; nothing stored. */
  status: 'ok' | 'conflict' | 'empty' | 'deleted';
  saveId?: number;
  versionId?: number;
  conflictId?: number;
}

interface StateRow {
  version_id: number;
  sha256: string;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Hub-and-spoke sync. The server holds the current version of every save;
 * each device remembers (server-side) which version it last agreed on.
 * Comparing the device's file, its last agreed version and the server's
 * current version tells us which side changed:
 *
 *   device == server                        -> ok
 *   device unchanged since agreed, server moved  -> download
 *   server unchanged since agreed, device moved  -> upload
 *   both moved (or never agreed)            -> conflict, keep both, ask the user
 */
export class SyncService {
  readonly store: SaveStore;

  constructor(private ctx: AppContext) {
    this.store = new SaveStore(ctx);
  }

  private mapping(deviceId: number, platform: string, slot: string): { def: PlatformDef; profile: Profile } {
    const pc = this.ctx.platform(platform);
    if (!pc) throw new SyncError(`Unknown platform "${platform}"`);
    const row = this.ctx.db.get<{ profile: string }>(
      'SELECT profile FROM device_mappings WHERE device_id = $d AND platform = $p AND slot = $slot',
      { $d: deviceId, $p: platform, $slot: slot },
    );
    if (!row) throw new SyncError(`Device has no save mapping for ${platform}${slot ? ` (slot "${slot}")` : ''}`);
    const profile = this.ctx.profile(row.profile);
    if (!profile) throw new SyncError(`Unknown emulator profile "${row.profile}"`);
    return { def: pc.def, profile };
  }

  /** Device path -> canonical key, translating ROM names through the device's ROM matches. */
  private toKey(deviceId: number, def: PlatformDef, profile: Profile, localPath: string): ParsedSave | null {
    const key = parseSavePath(profile, def, localPath);
    if (!key) return null;
    if (def.keyKind === 'rom') {
      const serverStem = serverStemForLocal(this.ctx.db, deviceId, def.slug, key.gameKey);
      if (serverStem) key.gameKey = serverStem;
      // Platforms often share one saves folder (RetroArch's). Once the device
      // has reported its ROMs, a save only belongs here if one of them has its name.
      else if (this.deviceHasRomInventory(deviceId, def.slug) && !this.deviceHasRomStem(deviceId, def.slug, key.gameKey)) return null;
    }
    return key;
  }

  /** Canonical key -> device path, or null when the device doesn't have the game. */
  private toLocal(deviceId: number, def: PlatformDef, profile: Profile, save: SaveRow): string | null {
    let gameKey = save.game_key;
    if (def.keyKind === 'rom') {
      const local = localStemForServer(this.ctx.db, deviceId, def.slug, gameKey);
      if (local) gameKey = local;
      else if (this.deviceHasRomInventory(deviceId, def.slug)) return null;
    }
    return renderSavePath(profile, def, { gameKey, file: save.file });
  }

  private deviceHasRomInventory(deviceId: number, platform: string): boolean {
    return !!this.ctx.db.get('SELECT 1 AS x FROM device_roms WHERE device_id = $d AND platform = $p LIMIT 1', {
      $d: deviceId,
      $p: platform,
    });
  }

  private deviceHasRomStem(deviceId: number, platform: string, stem: string): boolean {
    return !!this.ctx.db.get('SELECT 1 AS x FROM device_roms WHERE device_id = $d AND platform = $p AND stem = $s LIMIT 1', {
      $d: deviceId,
      $p: platform,
      $s: stem,
    });
  }

  /** Whether this exact content of a save was deleted in the GUI (see save_tombstones). */
  private tombstoned(platform: string, key: ParsedSave, shas: string[]): boolean {
    return shas.some(
      (sha) =>
        !!this.ctx.db.get(
          'SELECT 1 AS x FROM save_tombstones WHERE platform = $p AND game_key = $k AND file = $f AND sha256 = $s',
          { $p: platform, $k: key.gameKey, $f: key.file, $s: sha },
        ),
    );
  }

  private state(deviceId: number, slot: string, saveId: number): StateRow | undefined {
    return this.ctx.db.get<StateRow>(
      'SELECT version_id, sha256 FROM device_save_state WHERE device_id = $d AND slot = $slot AND save_id = $s',
      { $d: deviceId, $slot: slot, $s: saveId },
    );
  }

  private setState(deviceId: number, slot: string, saveId: number, versionId: number, sha: string): void {
    this.ctx.db.run(
      `INSERT INTO device_save_state (device_id, slot, save_id, version_id, sha256, synced_at) VALUES ($d, $slot, $s, $v, $sha, $t)
       ON CONFLICT(device_id, save_id, slot) DO UPDATE SET version_id = excluded.version_id, sha256 = excluded.sha256, synced_at = excluded.synced_at`,
      { $d: deviceId, $slot: slot, $s: saveId, $v: versionId, $sha: sha, $t: now() },
    );
  }

  private openConflict(deviceId: number, saveId: number): { id: number } | undefined {
    return this.ctx.db.get<{ id: number }>(
      'SELECT id FROM conflicts WHERE save_id = $s AND device_id = $d AND resolved_at IS NULL',
      { $s: saveId, $d: deviceId },
    );
  }

  /**
   * `slot` picks which of the device's emulators for this platform is syncing
   * (see device_mappings). Each slot is its own copy with its own sync state.
   */
  plan(deviceId: number, platform: string, files: LocalSave[], slot = ''): SyncAction[] {
    const { def, profile } = this.mapping(deviceId, platform, slot);
    const actions: SyncAction[] = [];
    const handled = new Set<number>();

    for (const f of files) {
      const path = normalizePath(f.path);
      const key = this.toKey(deviceId, def, profile, path);
      if (!key) {
        actions.push({ action: 'unrecognized', path });
        continue;
      }
      const sha = f.sha256.toLowerCase();
      const empty = isEmptyHash(sha, Number(f.size));
      const save = this.store.findSave(platform, key);
      if (!save?.current_version_id) {
        if (this.tombstoned(platform, key, [sha])) actions.push({ action: 'deleted', path });
        else if (empty) actions.push({ action: 'empty', path });
        else actions.push({ action: 'upload', path, baseVersionId: null });
        continue;
      }
      handled.add(save.id);
      const current = this.store.getVersion(save.current_version_id)!;
      const state = this.state(deviceId, slot, save.id);
      const conflict = this.openConflict(deviceId, save.id);

      if (sha === current.sha256) {
        if (state?.version_id !== current.id) this.setState(deviceId, slot, save.id, current.id, current.sha256);
        actions.push({ action: 'ok', path, saveId: save.id, versionId: current.id });
      } else if (state && state.version_id === current.id && state.sha256 === sha) {
        // Same save, but the emulator wraps it differently (e.g. a .dsv footer).
        actions.push({ action: 'ok', path, saveId: save.id, versionId: current.id });
      } else if (conflict) {
        actions.push({ action: 'pending-conflict', path, saveId: save.id, conflictId: conflict.id });
      } else if (empty && !this.store.isEmptyVersion(platform, current.sha256)) {
        // The emulator made a blank save (a fresh install, or the game booted
        // before a download): never let it replace real progress.
        actions.push({ action: 'download', path, saveId: save.id, versionId: current.id, sha256: current.sha256, size: current.size });
      } else if (state && state.sha256 === sha) {
        actions.push({ action: 'download', path, saveId: save.id, versionId: current.id, sha256: current.sha256, size: current.size });
      } else if (state && state.version_id === current.id) {
        actions.push({ action: 'upload', path, baseVersionId: current.id });
      } else {
        actions.push({ action: 'conflict', path, saveId: save.id, serverVersionId: current.id, baseVersionId: state?.version_id ?? null });
      }
    }

    // Saves the server has that the device didn't report.
    const remote = this.ctx.db.all<SaveRow>('SELECT * FROM saves WHERE platform = $p AND current_version_id IS NOT NULL', {
      $p: platform,
    });
    const reported = new Set(actions.map((a) => a.path.toLowerCase()));
    for (const save of remote) {
      if (handled.has(save.id) || this.openConflict(deviceId, save.id)) continue;
      const path = this.toLocal(deviceId, def, profile, save);
      if (!path || reported.has(path.toLowerCase())) continue;
      const current = this.store.getVersion(save.current_version_id!)!;
      actions.push({ action: 'download', path, saveId: save.id, versionId: current.id, sha256: current.sha256, size: current.size });
    }
    return actions;
  }

  /**
   * Store a save uploaded by a device. If the server moved on since
   * `baseVersionId` (or the device says it is uploading its side of a
   * conflict), the upload is kept as a non-current version and a conflict
   * is opened for the user to resolve.
   */
  upload(
    deviceId: number,
    platform: string,
    localPath: string,
    data: Buffer,
    baseVersionId: number | null,
    asConflict: boolean,
    slot = '',
  ): UploadResult {
    const { def, profile } = this.mapping(deviceId, platform, slot);
    const key = this.toKey(deviceId, def, profile, localPath);
    if (!key) throw new SyncError(`"${localPath}" is not a save file for profile ${profile.id}`);
    // The device's state records the hash of the file as it is on the device;
    // the server stores the unwrapped raw save.
    const deviceSha = sha256Buffer(data);
    const raw = decodeSave(key.format, data);
    const sha = sha256Buffer(raw);

    return this.ctx.db.tx((): UploadResult => {
      const existing = this.store.findSave(platform, key);
      if (!existing?.current_version_id) {
        if (this.tombstoned(platform, key, [sha, deviceSha])) return { status: 'deleted' };
        // New content for a deleted save: it's a save again, so forget the deletion.
        this.ctx.db.run('DELETE FROM save_tombstones WHERE platform = $p AND game_key = $k AND file = $f', {
          $p: platform,
          $k: key.gameKey,
          $f: key.file,
        });
      }
      const save = existing ?? this.store.findOrCreateSave(platform, key);
      const current = save.current_version_id ? this.store.getVersion(save.current_version_id) : undefined;

      if (current?.sha256 === sha) {
        this.setState(deviceId, slot, save.id, current.id, deviceSha);
        return { status: 'ok' as const, saveId: save.id, versionId: current.id };
      }
      if (current && isEmptySave(platform, raw) && !this.store.isEmptyVersion(platform, current.sha256)) {
        // Kept in the history, but no sync state: the next plan downloads the real save.
        const known = this.ctx.db.get('SELECT 1 AS x FROM save_versions WHERE save_id = $s AND sha256 = $sha', { $s: save.id, $sha: sha });
        if (!known) {
          this.store.addVersion(save, raw, { deviceId, makeCurrent: false, note: 'Empty save from device; the current save was kept' });
        }
        return { status: 'empty', saveId: save.id, versionId: current.id };
      }
      if (!current || (!asConflict && current.id === baseVersionId && !this.openConflict(deviceId, save.id))) {
        const v = this.store.addVersion(save, raw, { deviceId, makeCurrent: true, parentVersionId: current?.id ?? null });
        this.setState(deviceId, slot, save.id, v.id, deviceSha);
        return { status: 'ok' as const, saveId: save.id, versionId: v.id };
      }

      const v = this.store.addVersion(save, raw, {
        deviceId,
        makeCurrent: false,
        parentVersionId: baseVersionId,
        note: 'Conflicting copy from device',
      });
      const open = this.openConflict(deviceId, save.id);
      let conflictId: number;
      if (open) {
        this.ctx.db.run('UPDATE conflicts SET device_version_id = $v WHERE id = $id', { $v: v.id, $id: open.id });
        conflictId = open.id;
      } else {
        conflictId = this.ctx.db.run(
          `INSERT INTO conflicts (save_id, device_id, server_version_id, device_version_id, created_at)
           VALUES ($s, $d, $sv, $dv, $t)`,
          { $s: save.id, $d: deviceId, $sv: current.id, $dv: v.id, $t: now() },
        ).lastId;
      }
      // The device now "agrees" with its own copy, so once the conflict is
      // resolved the plan above naturally downloads or confirms.
      this.setState(deviceId, slot, save.id, v.id, deviceSha);
      return { status: 'conflict' as const, saveId: save.id, versionId: v.id, conflictId };
    });
  }

  /** Device confirms it wrote a downloaded version to disk. */
  ack(deviceId: number, saveId: number, versionId: number, slot = ''): void {
    const v = this.store.getVersion(versionId);
    if (!v || v.save_id !== saveId) throw new SyncError('Version does not belong to that save', 404);
    this.setState(deviceId, slot, saveId, v.id, v.sha256);
  }

  resolveConflict(conflictId: number, keep: 'server' | 'device'): void {
    this.ctx.db.tx(() => {
      const c = this.ctx.db.get<{ save_id: number; device_version_id: number; resolved_at: number | null }>(
        'SELECT save_id, device_version_id, resolved_at FROM conflicts WHERE id = $id',
        { $id: conflictId },
      );
      if (!c || c.resolved_at) throw new SyncError('No open conflict with that id', 404);
      if (keep === 'device') this.store.setCurrent(c.save_id, c.device_version_id);
      this.ctx.db.run('UPDATE conflicts SET resolved_at = $t, resolution = $r WHERE id = $id', {
        $t: now(),
        $r: keep,
        $id: conflictId,
      });
    });
  }
}

const emptyHashCache = new Map<number, Set<string>>();

/**
 * Whether a file of this size and hash is blank: no bytes, or all 0x00 or all
 * 0xFF (what emulators write before a game saves). The plan only sees hashes,
 * so compare against the hashes of those blank files.
 */
function isEmptyHash(sha: string, size: number): boolean {
  if (!Number.isSafeInteger(size) || size < 0 || size > 32 * 1024 * 1024) return false;
  let hashes = emptyHashCache.get(size);
  if (!hashes) {
    hashes = new Set([sha256Buffer(Buffer.alloc(size, 0)), sha256Buffer(Buffer.alloc(size, 0xff))]);
    if (emptyHashCache.size > 64) emptyHashCache.clear();
    emptyHashCache.set(size, hashes);
  }
  return hashes.has(sha);
}
