import path from 'node:path';
import { getPlatform } from '../platforms.js';

/**
 * True when a save holds no game data: every byte the same (a cartridge
 * save the game never wrote, all 0x00 or 0xFF), or a formatted PlayStation
 * memory card with no blocks in use. Emulators create these as soon as a
 * game boots, so they must never replace a real save.
 */
export function isEmptySave(platform: string, data: Buffer): boolean {
  if (data.length === 0) return true;
  if (data.every((b) => b === data[0])) return true;
  if (platform === 'psx' && data.length === 128 * 1024 && data.toString('latin1', 0, 2) === 'MC') {
    // Directory frames 1-15 start with the block state: 0xA0-0xA3 free or deleted, 0x51-0x53 in use.
    for (let i = 1; i <= 15; i++) if ((data[i * 0x80]! & 0xf0) !== 0xa0) return false;
    return true;
  }
  return false;
}

/**
 * The name a save gets when downloaded on its own. ROM-keyed saves are
 * stored under canonical names ("battery.sav"); hand them out as
 * "<ROM name>.sav", which most emulators load as is.
 */
export function downloadName(platform: string, gameKey: string, file: string): string {
  if (getPlatform(platform)?.keyKind === 'rom') {
    if (file === 'battery.sav') return `${gameKey}.sav`;
    if (file === 'rtc') return `${gameKey}.rtc`;
    if (file === 'card2.mcd') return `${gameKey}_2.mcd`;
  }
  return path.posix.basename(file);
}
