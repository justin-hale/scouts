import type { Db } from './db.js';

/** Settings editable from the web GUI. Secrets are never sent back in full. */
export const PUBLIC_SETTINGS = {
  igdb_client_id: { secret: false, label: 'IGDB / Twitch client ID' },
  igdb_client_secret: { secret: true, label: 'IGDB / Twitch client secret' },
  steamgriddb_api_key: { secret: true, label: 'SteamGridDB API key' },
} as const;

export type PublicSettingKey = keyof typeof PUBLIC_SETTINGS;

export function getSetting(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>('SELECT value FROM settings WHERE key = $k', { $k: key })?.value;
}

export function setSetting(db: Db, key: string, value: string | null): void {
  if (value === null || value === '') {
    db.run('DELETE FROM settings WHERE key = $k', { $k: key });
  } else {
    db.run('INSERT INTO settings (key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value', {
      $k: key,
      $v: value,
    });
  }
}

export function publicSettings(db: Db) {
  return Object.entries(PUBLIC_SETTINGS).map(([key, def]) => {
    const value = getSetting(db, key);
    return {
      key,
      label: def.label,
      secret: def.secret,
      set: value !== undefined,
      value: def.secret ? null : (value ?? null),
    };
  });
}
