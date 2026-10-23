import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SAT32 = 0xffffffff;

export interface ZipEntryHead {
  name: string;
  head: Buffer;
}

interface Entry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  offset: number;
}

/**
 * Read the first `length` bytes of the largest file in a zip whose extension
 * is in `exts`, without extracting the archive. That is enough to read a
 * ROM's header (3DS title ID, GameCube/Wii disc ID) from a zipped ROM, so
 * people can keep zips on the server and still get title-keyed saves and
 * metadata. Handles stored and deflated entries and Zip64 archives.
 */
export async function readZipEntryHead(file: string, exts: Set<string>, length: number): Promise<ZipEntryHead | null> {
  const fh = await fs.open(file, 'r');
  try {
    const fileSize = (await fh.stat()).size;
    const tailLen = Math.min(fileSize, 0xffff + 22);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, fileSize - tailLen);
    const eocd = tail.lastIndexOf(EOCD);
    if (eocd < 0 || eocd + 22 > tail.length) return null;
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdSize === SAT32 || cdOffset === SAT32) {
      // Zip64: a locator sits just before the classic end record and points at the 64-bit one.
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== ZIP64_LOCATOR) return null;
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, rec.length, Number(tail.readBigUInt64LE(loc + 8)));
      if (rec.readUInt32LE(0) !== ZIP64_EOCD) return null;
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (cdSize > 16 << 20) return null;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);

    let best: Entry | null = null;
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === CENTRAL; ) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const e: Entry = {
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method: cd.readUInt16LE(p + 10),
        compSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42),
      };
      readZip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), e);
      p += 46 + nameLen + extraLen + commentLen;
      if (e.name.endsWith('/') || !exts.has(path.posix.extname(e.name).toLowerCase())) continue;
      if (!best || e.size > best.size) best = e;
    }
    if (!best || (best.method !== 0 && best.method !== 8)) return null;

    const local = Buffer.alloc(30);
    await fh.read(local, 0, 30, best.offset);
    if (local.readUInt32LE(0) !== LOCAL) return null;
    const dataStart = best.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);

    if (best.method === 0) {
      const head = Buffer.alloc(Math.min(length, best.size));
      const { bytesRead } = await fh.read(head, 0, head.length, dataStart);
      return { name: best.name, head: head.subarray(0, bytesRead) };
    }
    // Inflate a growing prefix of the compressed data until enough output
    // comes out. A small prefix keeps the output small even for long runs of
    // zeros, which compress about 1000:1.
    for (let take = 4096; ; take *= 4) {
      const n = Math.min(take, best.compSize);
      const raw = Buffer.alloc(n);
      const { bytesRead } = await fh.read(raw, 0, n, dataStart);
      const out = zlib.inflateRawSync(raw.subarray(0, bytesRead), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      if (out.length >= length || n >= best.compSize || take >= 1 << 20) return { name: best.name, head: out.subarray(0, length) };
    }
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/** Zip64 extra field: 64-bit values for whichever header fields were saturated, in this order. */
function readZip64Extra(extra: Buffer, e: Entry): void {
  for (let p = 0; p + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      const next = () => {
        const v = Number(extra.readBigUInt64LE(q));
        q += 8;
        return v;
      };
      if (e.size === SAT32) e.size = next();
      if (e.compSize === SAT32) e.compSize = next();
      if (e.offset === SAT32) e.offset = next();
    }
    p += 4 + len;
  }
}
