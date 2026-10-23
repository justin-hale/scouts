import fs from 'node:fs/promises';

const GC_MAGIC = 0xc2339f3d;
const WII_MAGIC = 0x5d1c9ea3;

export interface DiscId {
  system: 'gc' | 'wii';
  /** Six-character game ID, e.g. "GALE01" (Melee) or "RSBE01" (Brawl). */
  gameId: string;
}

/**
 * Read the game ID from a GameCube/Wii disc image. Handles plain ISO/GCM,
 * WBFS, and Dolphin's RVZ/WIA (which keep an uncompressed copy of the disc
 * header). Returns null for formats it can't read (GCZ, CISO, WAD).
 */
export async function readDiscId(file: string): Promise<DiscId | null> {
  const fh = await fs.open(file, 'r');
  try {
    const head = Buffer.alloc(0x300);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    return parseDiscImage(head.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Game ID from the first 0x300 bytes of a disc image in any of the formats above (also used for zipped ROMs). */
export function parseDiscImage(head: Buffer): DiscId | null {
  if (head.length < 0x60) return null;
  const magic = head.toString('latin1', 0, 4);
  let offset = 0;
  if (magic === 'WBFS') offset = 0x200;
  else if (magic === 'RVZ\x01' || magic === 'WIA\x01') offset = 0x58;
  return parseDiscHeader(head.subarray(offset, offset + 0x80));
}

export function parseDiscHeader(h: Buffer): DiscId | null {
  if (h.length < 0x20) return null;
  const gameId = h.toString('latin1', 0, 6);
  if (!/^[A-Z0-9]{6}$/.test(gameId)) return null;
  if (h.readUInt32BE(0x18) === WII_MAGIC) return { system: 'wii', gameId };
  if (h.readUInt32BE(0x1c) === GC_MAGIC) return { system: 'gc', gameId };
  return null;
}

/**
 * Wii disc games keep NAND saves under title/00010000/<hex of the first four
 * game ID characters>, e.g. RSBE01 -> 00010000 + "RSBE" -> 0001000052534245.
 */
export function wiiTitleId(gameId: string): string {
  return `00010000${Buffer.from(gameId.slice(0, 4), 'latin1').toString('hex')}`;
}
