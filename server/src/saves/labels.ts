import fs from 'node:fs';
import path from 'node:path';

/**
 * A readable name for a save that isn't tied to a library game, taken from
 * the save itself where the format carries one. GameCube GCI files embed the
 * game's name and a description ("The Legend of Zelda" / "Link: 3 hearts").
 */
export function saveLabel(platform: string, file: string, blobPath: string): string | null {
  if (platform !== 'gc' || path.extname(file).toLowerCase() !== '.gci') return null;
  try {
    return gciComment(fs.readFileSync(blobPath));
  } catch {
    return null;
  }
}

// GCI = 0x40-byte directory entry + card data. The entry's comment address
// (0x3c) points into the data at two 32-byte strings: game name, then detail.
export function gciComment(gci: Buffer): string | null {
  if (gci.length < 0x40) return null;
  const at = 0x40 + gci.readUInt32BE(0x3c);
  if (at + 64 > gci.length) return null;
  // Japanese games (game code ending in J) use Shift-JIS, the rest Windows-1252.
  const encoding = gci.toString('latin1', 3, 4) === 'J' ? 'shift_jis' : 'windows-1252';
  const decoder = new TextDecoder(encoding);
  const field = (start: number) => decoder.decode(gci.subarray(start, start + 32)).replace(/\0[\s\S]*$/, '').trim();
  const name = field(at);
  const detail = field(at + 32);
  if (!name) return null;
  return detail && detail !== name ? `${name} · ${detail}` : name;
}
