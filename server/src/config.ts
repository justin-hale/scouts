import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src or server/dist -> repository root
const repoRoot = path.resolve(here, '..', '..');

export interface Config {
  port: number;
  host: string;
  /** Holds the SQLite database, save blobs and downloaded cover art. */
  dataDir: string;
  /** Directory of emulator profile YAML files. */
  profilesDir: string;
  /** Built web GUI to serve, if present. */
  webDir: string;
  /** Password for the web GUI. Required unless auth is explicitly disabled. */
  adminPassword: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.BONFIRE_PORT ?? 8080),
    host: env.BONFIRE_HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.BONFIRE_DATA_DIR ?? path.join(repoRoot, 'data')),
    profilesDir: path.resolve(env.BONFIRE_PROFILES_DIR ?? path.join(repoRoot, 'profiles')),
    webDir: path.resolve(env.BONFIRE_WEB_DIR ?? path.join(repoRoot, 'web', 'dist')),
    adminPassword: env.BONFIRE_ADMIN_PASSWORD || undefined,
  };
}
