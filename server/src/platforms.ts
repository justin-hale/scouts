/**
 * Built-in platform catalog. Server-specific settings (paths, layout
 * overrides) live in the `platforms` table and are merged on top.
 *
 * Every save is identified by a *game key* plus a file name inside that
 * game. `keyFormat` is a template (see profiles/template.ts) that splits a
 * game key into the variables emulator profiles and save layouts use.
 *
 * - `rom`:     the game key is the ROM file name without extension. Used by
 *              cartridge systems whose emulators name saves after the ROM.
 * - `titleId`: a platform-native title ID (3DS).
 * - `saveDir`: the emulator's own save folder name (PSP SAVEDATA dirs).
 */
export type KeyKind = 'rom' | 'titleId' | 'saveDir';

export interface PlatformDef {
  slug: string;
  name: string;
  romExtensions: string[];
  keyKind: KeyKind;
  keyFormat: string;
  /** Where the server keeps the current copy of each save, relative to the platform's save path. */
  defaultSaveLayout: string;
  igdbPlatformId?: number;
  /** System folder name on thumbnails.libretro.com, used for keyless cover art. */
  libretroName?: string;
}

const ARCHIVES = ['.zip', '.7z'];

const romPlatform = (
  slug: string,
  name: string,
  exts: string[],
  igdbPlatformId: number,
  libretroName: string,
  archives = true,
): PlatformDef => ({
  slug,
  name,
  romExtensions: archives ? [...exts, ...ARCHIVES] : exts,
  keyKind: 'rom',
  keyFormat: '{game}',
  defaultSaveLayout: '{game}/{file**}',
  igdbPlatformId,
  libretroName,
});

export const PLATFORMS: PlatformDef[] = [
  romPlatform('nes', 'Nintendo Entertainment System', ['.nes', '.fds', '.unf'], 18, 'Nintendo - Nintendo Entertainment System'),
  romPlatform('snes', 'Super Nintendo', ['.sfc', '.smc'], 19, 'Nintendo - Super Nintendo Entertainment System'),
  romPlatform('n64', 'Nintendo 64', ['.n64', '.z64', '.v64'], 4, 'Nintendo - Nintendo 64'),
  romPlatform('gb', 'Game Boy', ['.gb'], 33, 'Nintendo - Game Boy'),
  romPlatform('gbc', 'Game Boy Color', ['.gbc'], 22, 'Nintendo - Game Boy Color'),
  romPlatform('gba', 'Game Boy Advance', ['.gba'], 24, 'Nintendo - Game Boy Advance'),
  romPlatform('nds', 'Nintendo DS', ['.nds', '.dsi'], 20, 'Nintendo - Nintendo DS'),
  {
    slug: '3ds',
    name: 'Nintendo 3DS',
    romExtensions: ['.3ds', '.cci', '.cia', '.cxi', '.3dsx', '.app'],
    keyKind: 'titleId',
    keyFormat: '{category:8}{titleLow:8}',
    defaultSaveLayout:
      'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/{category}/{titleLow}/data/{file**}',
    igdbPlatformId: 37,
    libretroName: 'Nintendo - Nintendo 3DS',
  },
  romPlatform('gc', 'GameCube', ['.iso', '.gcm', '.rvz', '.ciso', '.gcz'], 21, 'Nintendo - GameCube', false),
  romPlatform('wii', 'Wii', ['.iso', '.wbfs', '.rvz', '.wad', '.gcz'], 5, 'Nintendo - Wii', false),
  romPlatform('genesis', 'Sega Genesis / Mega Drive', ['.md', '.gen', '.bin', '.smd'], 29, 'Sega - Mega Drive - Genesis'),
  romPlatform('sms', 'Sega Master System', ['.sms'], 64, 'Sega - Master System - Mark III'),
  romPlatform('gg', 'Sega Game Gear', ['.gg'], 35, 'Sega - Game Gear'),
  romPlatform('psx', 'PlayStation', ['.cue', '.chd', '.pbp', '.m3u', '.iso'], 7, 'Sony - PlayStation', false),
  romPlatform('ps2', 'PlayStation 2', ['.iso', '.chd', '.cso'], 8, 'Sony - PlayStation 2', false),
  {
    slug: 'psp',
    name: 'PlayStation Portable',
    romExtensions: ['.iso', '.cso', '.chd', '.pbp'],
    keyKind: 'saveDir',
    keyFormat: '{saveDir}',
    defaultSaveLayout: 'SAVEDATA/{saveDir}/{file**}',
    igdbPlatformId: 38,
    libretroName: 'Sony - PlayStation Portable',
  },
];

const bySlug = new Map(PLATFORMS.map((p) => [p.slug, p]));

export function getPlatform(slug: string): PlatformDef | undefined {
  return bySlug.get(slug);
}
