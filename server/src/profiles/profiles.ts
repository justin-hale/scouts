import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { PlatformDef } from '../platforms.js';
import { SAVE_FORMATS, type SaveFormat } from '../saves/formats.js';
import { matchTemplate, normalizePath, renderTemplate, templateVars, type Vars } from './template.js';

/**
 * An emulator profile describes how one emulator lays out save files inside
 * the folder a user picks on their device. See docs/emulator-profiles.md.
 */
export interface SaveRule {
  /** Platform slugs this rule covers; "*" means every platform keyed by ROM name. */
  platforms: string[];
  /** Path relative to the picked folder. */
  pattern: string;
  /** Canonical file name when the pattern has no {file} variable. */
  file?: string;
  /** Values for pattern variables that don't come from the game key (e.g. 3DS id0/id1). */
  defaults?: Vars;
  /** Wrapper the emulator puts around the raw save, stripped on upload. */
  format?: SaveFormat;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  /** Hints for clients about where this emulator usually keeps saves. */
  defaultPaths?: { android?: string[]; windows?: string[] };
  saves: SaveRule[];
}

export interface SaveKey {
  gameKey: string;
  file: string;
}

export interface ParsedSave extends SaveKey {
  format?: SaveFormat;
}

export function loadProfiles(dir: string): Profile[] {
  if (!fs.existsSync(dir)) return [];
  const profiles: Profile[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const doc = YAML.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    profiles.push(validateProfile(doc, name));
  }
  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) throw new Error(`Duplicate profile id "${p.id}"`);
    ids.add(p.id);
  }
  return profiles;
}

export function validateProfile(doc: unknown, source = 'profile'): Profile {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };
  if (!doc || typeof doc !== 'object') fail('not a mapping');
  const p = doc as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) fail('id must be lowercase letters, digits and dashes');
  if (typeof p.name !== 'string') fail('name is required');
  if (!Array.isArray(p.saves) || p.saves.length === 0) fail('saves must be a non-empty list');
  const saves = (p.saves as unknown[]).map((r, i): SaveRule => {
    const rule = r as Record<string, unknown>;
    const platforms = rule.platforms;
    if (!Array.isArray(platforms) || !platforms.every((x) => typeof x === 'string')) fail(`saves[${i}].platforms must be a list`);
    if (typeof rule.pattern !== 'string') fail(`saves[${i}].pattern is required`);
    const vars = templateVars(rule.pattern as string);
    if (!vars.includes('file') && typeof rule.file !== 'string') fail(`saves[${i}] needs a {file} variable or a file name`);
    if (rule.format !== undefined && !SAVE_FORMATS.includes(rule.format as SaveFormat)) {
      fail(`saves[${i}].format must be one of: ${SAVE_FORMATS.join(', ')}`);
    }
    return {
      platforms: platforms as string[],
      pattern: rule.pattern as string,
      file: rule.file as string | undefined,
      defaults: (rule.defaults as Vars | undefined) ?? undefined,
      format: rule.format as SaveFormat | undefined,
    };
  });
  return {
    id: p.id as string,
    name: p.name as string,
    description: typeof p.description === 'string' ? p.description : undefined,
    defaultPaths: p.defaultPaths as Profile['defaultPaths'],
    saves,
  };
}

function rulesFor(profile: Profile, platform: PlatformDef): SaveRule[] {
  const keyVars = templateVars(platform.keyFormat);
  return profile.saves.filter((rule) => {
    const listed = rule.platforms.includes(platform.slug) || (rule.platforms.includes('*') && platform.keyKind === 'rom');
    if (!listed) return false;
    const vars = templateVars(rule.pattern);
    return keyVars.every((v) => vars.includes(v));
  });
}

export function profileSupports(profile: Profile, platform: PlatformDef): boolean {
  return rulesFor(profile, platform).length > 0;
}

export function normalizeGameKey(platform: PlatformDef, key: string): string {
  return platform.keyKind === 'titleId' ? key.toLowerCase() : key;
}

/** Turn a device-relative save path into its canonical key, or null if the profile doesn't recognise it. */
export function parseSavePath(profile: Profile, platform: PlatformDef, relPath: string): ParsedSave | null {
  const p = normalizePath(relPath);
  for (const rule of rulesFor(profile, platform)) {
    const vars = matchTemplate(rule.pattern, p);
    if (!vars) continue;
    const gameKey = renderTemplate(platform.keyFormat, vars);
    const file = vars.file ?? rule.file;
    if (!gameKey || !file) continue;
    return { gameKey: normalizeGameKey(platform, gameKey), file, ...(rule.format && { format: rule.format }) };
  }
  return null;
}

/** Render where a canonical save lives inside a device folder, or null if the profile can't place it. */
export function renderSavePath(profile: Profile, platform: PlatformDef, key: SaveKey): string | null {
  const keyVars = matchTemplate(platform.keyFormat, key.gameKey);
  if (!keyVars) return null;
  for (const rule of rulesFor(profile, platform)) {
    const hasFileVar = templateVars(rule.pattern).includes('file');
    if (!hasFileVar && rule.file !== key.file) continue;
    const out = renderTemplate(rule.pattern, { ...rule.defaults, ...keyVars, file: key.file });
    if (out) return out;
  }
  return null;
}

/** The server's own save layout is a single-rule profile. */
export function layoutProfile(platform: PlatformDef, layout: string): Profile {
  return {
    id: `server-${platform.slug}`,
    name: 'Server layout',
    saves: [{ platforms: [platform.slug], pattern: layout }],
  };
}

export function validateLayout(platform: PlatformDef, layout: string): string | null {
  let vars: string[];
  try {
    vars = templateVars(layout);
  } catch (e) {
    return (e as Error).message;
  }
  if (!vars.includes('file')) return 'Layout must contain {file} or {file**}';
  const missing = templateVars(platform.keyFormat).filter((v) => !vars.includes(v));
  if (missing.length) return `Layout must contain ${missing.map((v) => `{${v}}`).join(', ')}`;
  return null;
}
