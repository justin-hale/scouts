import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { crc32File } from './hash.js';

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

/**
 * Extract every file of a small in-memory zip (an uploaded save folder, as
 * RomM and Citra export them). Directories are skipped. Throws on archives it
 * can't read, or once the output passes `maxTotal` bytes.
 */
export function unzipBuffer(zip: Buffer, maxTotal = 256 * 1024 * 1024): { name: string; data: Buffer }[] {
  const eocd = zip.lastIndexOf(EOCD);
  if (eocd < 0 || eocd + 22 > zip.length) throw new Error('Not a zip file');
  let cdOffset = zip.readUInt32LE(eocd + 16);
  if (cdOffset === SAT32) {
    const loc = eocd - 20;
    if (loc < 0 || zip.readUInt32LE(loc) !== ZIP64_LOCATOR) throw new Error('Unreadable zip');
    const rec = Number(zip.readBigUInt64LE(loc + 8));
    cdOffset = Number(zip.readBigUInt64LE(rec + 48));
  }
  const out: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (let p = cdOffset; p + 46 <= zip.length && zip.readUInt32LE(p) === CENTRAL; ) {
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const crc = zip.readUInt32LE(p + 16);
    const e: Entry = {
      name: zip.toString('utf8', p + 46, p + 46 + nameLen),
      method: zip.readUInt16LE(p + 10),
      compSize: zip.readUInt32LE(p + 20),
      size: zip.readUInt32LE(p + 24),
      offset: zip.readUInt32LE(p + 42),
    };
    readZip64Extra(zip.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), e);
    p += 46 + nameLen + extraLen + commentLen;
    if (e.name.endsWith('/')) continue;
    if (zip.readUInt32LE(e.offset) !== LOCAL) throw new Error('Unreadable zip');
    const start = e.offset + 30 + zip.readUInt16LE(e.offset + 26) + zip.readUInt16LE(e.offset + 28);
    const raw = zip.subarray(start, start + e.compSize);
    let data: Buffer;
    if (e.method === 0) data = Buffer.from(raw);
    else if (e.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, maxTotal - total) });
    else throw new Error(`"${e.name}" uses an unsupported compression method`);
    total += data.length;
    if (total > maxTotal) throw new Error('Zip is too large');
    if (zlib.crc32(data) !== crc) throw new Error(`"${e.name}" is corrupt (CRC mismatch)`);
    out.push({ name: e.name.replace(/\\/g, '/'), data });
  }
  return out;
}

export interface ZipInput {
  name: string;
  data: Buffer;
  mtime?: Date;
}

/**
 * Write a zip as a stream, one deflated entry at a time, so exporting every
 * save never holds the whole archive in memory. Entries are expected to be
 * small (saves), and the archive under 4 GB (no Zip64).
 */
export function zipStream(entries: Iterable<ZipInput>): Readable {
  return Readable.from(
    (function* () {
      const central: Buffer[] = [];
      let offset = 0;
      let count = 0;
      for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8');
        const comp = zlib.deflateRawSync(e.data);
        const crc = zlib.crc32(e.data);
        const { time, date } = dosTime(e.mtime ?? new Date());
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(e.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(CENTRAL, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(8, 10);
        cd.writeUInt16LE(time, 12);
        cd.writeUInt16LE(date, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(comp.length, 20);
        cd.writeUInt32LE(e.data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt32LE(offset, 42);
        central.push(cd, name);
        yield Buffer.concat([local, name, comp]);
        offset += 30 + name.length + comp.length;
        count++;
        if (offset > SAT32 || count >= 0xffff) throw new Error('Export too large for a zip');
      }
      const cdBuf = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(count, 8);
      end.writeUInt16LE(count, 10);
      end.writeUInt32LE(cdBuf.length, 12);
      end.writeUInt32LE(offset, 16);
      yield Buffer.concat([cdBuf, end]);
    })(),
    { objectMode: false },
  );
}

export interface ZipFile {
  /** Name inside the zip. */
  name: string;
  /** File on disk. */
  path: string;
  /** Size, mtime and CRC recorded at scan time; the CRC is recomputed if the file has changed since. */
  size?: number;
  mtime?: number;
  crc32?: string;
}

/**
 * Stream files from disk as a zip without loading them: entries are stored
 * (disc tracks barely compress) with their exact CRC and sizes in the local
 * headers, so every unzipper can read it, including Java's ZipInputStream,
 * which can't handle stored entries with trailing data descriptors.
 */
export function zipFilesStream(files: ZipFile[]): Readable {
  return Readable.from(
    (async function* () {
      const central: Buffer[] = [];
      let offset = 0;
      for (const f of files) {
        const st = await fs.stat(f.path);
        const unchanged = f.crc32 && f.size === st.size && f.mtime === Math.floor(st.mtimeMs);
        const crc = parseInt(unchanged ? f.crc32! : await crc32File(f.path), 16);
        if (offset + st.size + 30 + Buffer.byteLength(f.name) > SAT32) {
          throw Object.assign(new Error('This ROM set is larger than 4 GB; download its files one by one'), { statusCode: 413 });
        }
        const name = Buffer.from(f.name, 'utf8');
        const { time, date } = dosTime(st.mtime);
        const header = (central: boolean) => {
          const h = Buffer.alloc(central ? 46 : 30);
          let p = 0;
          h.writeUInt32LE(central ? CENTRAL : LOCAL, p);
          if (central) h.writeUInt16LE(20, (p += 4));
          h.writeUInt16LE(20, (p += central ? 2 : 4)); // version needed
          h.writeUInt16LE(0x0800, (p += 2)); // UTF-8 names
          h.writeUInt16LE(0, (p += 2)); // stored
          h.writeUInt16LE(time, (p += 2));
          h.writeUInt16LE(date, (p += 2));
          h.writeUInt32LE(crc >>> 0, (p += 2));
          h.writeUInt32LE(st.size, (p += 4));
          h.writeUInt32LE(st.size, (p += 4));
          h.writeUInt16LE(name.length, (p += 4));
          if (central) h.writeUInt32LE(offset, 42);
          return h;
        };
        central.push(header(true), name);
        yield Buffer.concat([header(false), name]);
        for await (const chunk of createReadStream(f.path, { highWaterMark: 1 << 20 })) yield chunk as Buffer;
        offset += 30 + name.length + st.size;
      }
      const cd = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(files.length, 8);
      end.writeUInt16LE(files.length, 10);
      end.writeUInt32LE(cd.length, 12);
      end.writeUInt32LE(offset, 16);
      yield Buffer.concat([cd, end]);
    })(),
  );
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
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
