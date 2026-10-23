import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

export interface FileHashes {
  crc32: string;
  md5: string;
  sha1: string;
}

/** CRC32, MD5 and SHA-1 in a single streaming pass (the hashes ROM databases use). */
export async function hashRom(file: string): Promise<FileHashes> {
  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    const buf = chunk as Buffer;
    md5.update(buf);
    sha1.update(buf);
    crc = zlib.crc32(buf, crc);
  }
  return {
    crc32: crc.toString(16).padStart(8, '0'),
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
  };
}

/** CRC32 of a file, streamed (for track files, which are never matched by hash). */
export async function crc32File(file: string): Promise<string> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) crc = zlib.crc32(chunk as Buffer, crc);
  return crc.toString(16).padStart(8, '0');
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
