import fs from 'node:fs/promises';

/**
 * Read the 64-bit title ID from a 3DS cartridge image (NCSD: .3ds/.cci) or a
 * bare NCCH (.cxi/.app). The headers are unencrypted even on encrypted dumps.
 * Returns 16 lower-case hex digits, matching Citra-style save folders
 * ("title/00040000/000a5e00"), or null for other formats such as CIA.
 */
export async function read3dsTitleId(file: string): Promise<string | null> {
  const fh = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(0x200);
    const { bytesRead } = await fh.read(header, 0, header.length, 0);
    if (bytesRead < 0x120) return null;
    const magic = header.toString('ascii', 0x100, 0x104);
    let id: bigint;
    if (magic === 'NCSD') id = header.readBigUInt64LE(0x108);
    else if (magic === 'NCCH') id = header.readBigUInt64LE(0x118);
    else return null;
    return id === 0n ? null : id.toString(16).padStart(16, '0');
  } finally {
    await fh.close();
  }
}
