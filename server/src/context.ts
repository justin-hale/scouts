import path from 'node:path';
import type { Auth } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { getPlatform, PLATFORMS, type PlatformDef } from './platforms.js';
import type { Profile } from './profiles/profiles.js';

export interface PlatformConfig {
  def: PlatformDef;
  enabled: boolean;
  romPath: string | null;
  savePath: string | null;
  /** Effective layout: the override if set, else the catalog default. */
  saveLayout: string;
  saveLayoutOverride: string | null;
}

interface PlatformRow {
  slug: string;
  enabled: number;
  rom_path: string | null;
  save_path: string | null;
  save_layout: string | null;
}

export class AppContext {
  readonly blobDir: string;
  readonly coverDir: string;

  constructor(
    readonly config: Config,
    readonly db: Db,
    readonly auth: Auth,
    readonly profiles: Profile[],
  ) {
    this.blobDir = path.join(config.dataDir, 'blobs');
    this.coverDir = path.join(config.dataDir, 'covers');
  }

  profile(id: string): Profile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  platform(slug: string): PlatformConfig | undefined {
    const def = getPlatform(slug);
    if (!def) return undefined;
    const row = this.db.get<PlatformRow>('SELECT * FROM platforms WHERE slug = $s', { $s: slug });
    return toConfig(def, row);
  }

  platforms(): PlatformConfig[] {
    const rows = new Map(this.db.all<PlatformRow>('SELECT * FROM platforms').map((r) => [r.slug, r]));
    return PLATFORMS.map((def) => toConfig(def, rows.get(def.slug)));
  }
}

function toConfig(def: PlatformDef, row: PlatformRow | undefined): PlatformConfig {
  return {
    def,
    enabled: row ? row.enabled === 1 : true,
    romPath: row?.rom_path ?? null,
    savePath: row?.save_path ?? null,
    saveLayout: row?.save_layout || def.defaultSaveLayout,
    saveLayoutOverride: row?.save_layout ?? null,
  };
}
