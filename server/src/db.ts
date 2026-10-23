import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Params = Record<string, SQLInputValue>;

/** Thin wrapper over node:sqlite with typed helpers and transactions. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(this);
  }

  get<T>(sql: string, params: Params = {}): T | undefined {
    return this.raw.prepare(sql).get(params) as T | undefined;
  }

  all<T>(sql: string, params: Params = {}): T[] {
    return this.raw.prepare(sql).all(params) as T[];
  }

  run(sql: string, params: Params = {}): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

const migrations: string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Server-side configuration for each platform in the catalog.
  CREATE TABLE platforms (
    slug        TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    rom_path    TEXT,
    save_path   TEXT,
    save_layout TEXT
  );

  CREATE TABLE games (
    id              INTEGER PRIMARY KEY,
    platform        TEXT NOT NULL,
    title           TEXT NOT NULL,
    -- Platform-native identifier (3DS title ID, PSP serial, ...)
    title_id        TEXT,
    igdb_id         INTEGER,
    sgdb_id         INTEGER,
    summary         TEXT,
    release_date    TEXT,
    cover_file      TEXT,
    metadata_source TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX games_platform ON games(platform, title);
  CREATE UNIQUE INDEX games_title_id ON games(platform, title_id) WHERE title_id IS NOT NULL;

  CREATE TABLE roms (
    id        INTEGER PRIMARY KEY,
    platform  TEXT NOT NULL,
    game_id   INTEGER REFERENCES games(id) ON DELETE SET NULL,
    rel_path  TEXT NOT NULL,
    file_name TEXT NOT NULL,
    stem      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime     INTEGER NOT NULL,
    crc32     TEXT,
    md5       TEXT,
    sha1      TEXT,
    title_id  TEXT,
    missing   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(platform, rel_path)
  );
  CREATE INDEX roms_game ON roms(game_id);
  CREATE INDEX roms_sha1 ON roms(sha1);
  CREATE INDEX roms_stem ON roms(platform, stem);

  -- One row per logical save file, identified by (platform, game_key, file).
  CREATE TABLE saves (
    id                 INTEGER PRIMARY KEY,
    platform           TEXT NOT NULL,
    game_key           TEXT NOT NULL,
    file               TEXT NOT NULL,
    game_id            INTEGER REFERENCES games(id) ON DELETE SET NULL,
    current_version_id INTEGER,
    UNIQUE(platform, game_key, file)
  );
  CREATE INDEX saves_game ON saves(game_id);

  CREATE TABLE save_versions (
    id                INTEGER PRIMARY KEY,
    save_id           INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    sha256            TEXT NOT NULL,
    size              INTEGER NOT NULL,
    device_id         INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    parent_version_id INTEGER,
    note              TEXT,
    created_at        INTEGER NOT NULL
  );
  CREATE INDEX save_versions_save ON save_versions(save_id, id);

  CREATE TABLE devices (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER
  );

  CREATE TABLE pairing_codes (
    code       TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  -- Where a device keeps each platform's saves and ROMs. Paths are the
  -- device's own (a SAF tree URI on Android, a folder on Windows) and are
  -- informational for the server; the profile decides the layout inside.
  CREATE TABLE device_mappings (
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    platform  TEXT NOT NULL,
    profile   TEXT NOT NULL,
    save_root TEXT,
    rom_root  TEXT,
    PRIMARY KEY (device_id, platform)
  );

  -- ROM files a device reported having, and which server ROM each one is.
  CREATE TABLE device_roms (
    id         INTEGER PRIMARY KEY,
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL,
    local_path TEXT NOT NULL,
    stem       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    sha1       TEXT,
    rom_id     INTEGER REFERENCES roms(id) ON DELETE SET NULL,
    match_kind TEXT NOT NULL,
    UNIQUE(device_id, platform, local_path)
  );
  CREATE INDEX device_roms_rom ON device_roms(device_id, rom_id);

  CREATE TABLE device_rom_queue (
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    rom_id       INTEGER NOT NULL REFERENCES roms(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, rom_id)
  );

  -- The save version each device last agreed with the server on.
  CREATE TABLE device_save_state (
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    save_id    INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    version_id INTEGER NOT NULL,
    sha256     TEXT NOT NULL,
    synced_at  INTEGER NOT NULL,
    PRIMARY KEY (device_id, save_id)
  );

  CREATE TABLE conflicts (
    id                INTEGER PRIMARY KEY,
    save_id           INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    device_id         INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    server_version_id INTEGER NOT NULL,
    device_version_id INTEGER NOT NULL,
    created_at        INTEGER NOT NULL,
    resolved_at       INTEGER,
    resolution        TEXT
  );
  CREATE INDEX conflicts_open ON conflicts(save_id, device_id) WHERE resolved_at IS NULL;
  `,
  `
  -- Files in RomM-style side folders of the ROM folder (dlc/, mod/, hack/,
  -- firmware/ ...). Listed and downloadable, but not ROMs: not hashed, not
  -- matched against devices.
  CREATE TABLE extras (
    id        INTEGER PRIMARY KEY,
    platform  TEXT NOT NULL,
    game_id   INTEGER REFERENCES games(id) ON DELETE SET NULL,
    kind      TEXT NOT NULL,
    rel_path  TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime     INTEGER NOT NULL,
    missing   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(platform, rel_path)
  );
  CREATE INDEX extras_game ON extras(game_id);

  -- Saves found next to ROMs, with the content last imported from each file.
  -- Only a change to the file there makes a new version, so an old copy
  -- beside the ROM never overrides a newer save that came from a device.
  CREATE TABLE rom_folder_saves (
    platform TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    sha256   TEXT NOT NULL,
    PRIMARY KEY (platform, rel_path)
  );
  `,
  `
  -- Files a ROM needs alongside it: the tracks of a .cue/.gdi, the discs an
  -- .m3u lists, a CloneCD image's .ccd/.sub. JSON array of
  -- { path, size, mtime, crc32 }; the CRCs let downloads stream the set as a
  -- zip with exact headers. total_size includes the ROM itself.
  ALTER TABLE roms ADD COLUMN parts TEXT;
  ALTER TABLE roms ADD COLUMN total_size INTEGER;
  `,
];

function migrate(db: Db): void {
  db.raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.get<{ version: number }>('SELECT version FROM schema_version');
  let version = row?.version ?? 0;
  if (!row) db.run('INSERT INTO schema_version (version) VALUES (0)');
  for (; version < migrations.length; version++) {
    db.tx(() => {
      db.raw.exec(migrations[version]!);
      db.run('UPDATE schema_version SET version = $v', { $v: version + 1 });
    });
  }
}

export const now = (): number => Date.now();
