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
 * - `titleId`: a platform-native title ID (3DS, Wii NAND saves).
 * - `saveDir`: the emulator's own save folder name (PSP SAVEDATA dirs).
 * - `card`:    a memory card shared by many games (GameCube, PS2, Dreamcast
 *              VMUs). These saves are synced as whole cards and are not tied
 *              to a single game.
 */
export type KeyKind = 'rom' | 'titleId' | 'saveDir' | 'card';

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
  // Plenty of people keep original Game Boy games in their GBC folder and play them in the GBC emulator.
  romPlatform('gbc', 'Game Boy Color', ['.gbc', '.gb'], 22, 'Nintendo - Game Boy Color'),
  romPlatform('gba', 'Game Boy Advance', ['.gba'], 24, 'Nintendo - Game Boy Advance'),
  romPlatform('nds', 'Nintendo DS', ['.nds', '.dsi'], 20, 'Nintendo - Nintendo DS'),
  {
    slug: '3ds',
    name: 'Nintendo 3DS',
    romExtensions: ['.3ds', '.cci', '.cia', '.cxi', '.3dsx', '.app', ...ARCHIVES],
    keyKind: 'titleId',
    keyFormat: '{category:8}{titleLow:8}',
    defaultSaveLayout:
      'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/{category}/{titleLow}/data/{file**}',
    igdbPlatformId: 37,
    libretroName: 'Nintendo - Nintendo 3DS',
  },
  {
    slug: 'gc',
    name: 'GameCube',
    romExtensions: ['.iso', '.gcm', '.rvz', '.ciso', '.gcz', '.wia', ...ARCHIVES],
    keyKind: 'card',
    // Dolphin memory cards are per region and slot ("MemoryCardA.USA.raw",
    // or a "GC/USA/Card A" folder of .gci files).
    keyFormat: '{region}/{slot:1}',
    defaultSaveLayout: '{region}/Card {slot}/{file**}',
    igdbPlatformId: 21,
    libretroName: 'Nintendo - GameCube',
  },
  {
    slug: 'wii',
    name: 'Wii',
    romExtensions: ['.iso', '.wbfs', '.rvz', '.wia', '.gcz', '.wad', ...ARCHIVES],
    keyKind: 'titleId',
    keyFormat: '{category:8}{titleLow:8}',
    defaultSaveLayout: 'title/{category}/{titleLow}/data/{file**}',
    igdbPlatformId: 5,
    libretroName: 'Nintendo - Wii',
  },
  romPlatform('genesis', 'Sega Genesis / Mega Drive', ['.md', '.gen', '.bin', '.smd'], 29, 'Sega - Mega Drive - Genesis'),
  romPlatform('sms', 'Sega Master System', ['.sms'], 64, 'Sega - Master System - Mark III'),
  romPlatform('gg', 'Sega Game Gear', ['.gg'], 35, 'Sega - Game Gear'),
  // Bare .bin/.img images run fine in most emulators. Track files a .cue or
  // .gdi points at are skipped by the scanner (library/sheets.ts).
  romPlatform('psx', 'PlayStation', ['.cue', '.chd', '.pbp', '.m3u', '.iso', '.bin', '.img'], 7, 'Sony - PlayStation'),
  {
    slug: 'ps2',
    name: 'PlayStation 2',
    romExtensions: ['.iso', '.chd', '.cso', '.zso', '.gz', '.cue', '.bin', ...ARCHIVES],
    keyKind: 'card',
    keyFormat: '{card}',
    defaultSaveLayout: '{card}/{file**}',
    igdbPlatformId: 8,
    libretroName: 'Sony - PlayStation 2',
  },
  {
    slug: 'psp',
    name: 'PlayStation Portable',
    romExtensions: ['.iso', '.cso', '.chd', '.pbp', ...ARCHIVES],
    keyKind: 'saveDir',
    keyFormat: '{saveDir}',
    defaultSaveLayout: 'SAVEDATA/{saveDir}/{file**}',
    igdbPlatformId: 38,
    libretroName: 'Sony - PlayStation Portable',
  },
  {
    slug: 'dreamcast',
    name: 'Dreamcast',
    romExtensions: ['.chd', '.gdi', '.cdi', '.cue', '.m3u', ...ARCHIVES],
    keyKind: 'card',
    // VMUs are named by controller port and slot: A1, A2, B1, ...
    keyFormat: '{card}',
    defaultSaveLayout: 'VMU {card}/{file**}',
    igdbPlatformId: 23,
    libretroName: 'Sega - Dreamcast',
  },
];

const bySlug = new Map(PLATFORMS.map((p) => [p.slug, p]));

export function getPlatform(slug: string): PlatformDef | undefined {
  return bySlug.get(slug);
}
