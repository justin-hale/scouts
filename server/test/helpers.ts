import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp, type Services } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface TestServer {
  app: FastifyInstance;
  services: Services;
  dir: string;
  cookie: string;
  admin: (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
  pairDevice: (name: string) => Promise<TestDevice>;
  close: () => Promise<void>;
}

export interface TestDevice {
  id: number;
  headers: Record<string, string>;
  call: (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
  upload: (platform: string, savePath: string, data: Buffer, base: number | null, conflict?: boolean) => Promise<any>;
  download: (versionId: number) => Promise<Buffer>;
}

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** A 3DS cartridge image (NCSD) carrying a title ID. */
export function ncsd(titleId: bigint): Buffer {
  const img = Buffer.alloc(0x8000);
  img.write('NCSD', 0x100, 'ascii');
  img.writeBigUInt64LE(titleId, 0x108);
  return img;
}

/** A GameCube disc image header with a game ID such as "GZLE01". */
export function gcDisc(gameId: string): Buffer {
  const img = Buffer.alloc(0x8000);
  img.write(gameId, 0, 'latin1');
  img.writeUInt32BE(0xc2339f3d, 0x1c);
  return img;
}

/** A Dolphin GCI save with the given game code, maker, internal file name and comment. */
export function gci(code: string, maker: string, name: string, detail: string, fileName = 'gamedata'): Buffer {
  const out = Buffer.alloc(0x40 + 0x2000);
  out.write(code, 0, 'latin1');
  out.write(maker, 4, 'latin1');
  out.write(fileName, 8, 'latin1');
  out.writeUInt32BE(0x100, 0x3c);
  out.write(name, 0x40 + 0x100, 'latin1');
  out.write(detail, 0x40 + 0x120, 'latin1');
  return out;
}

/** A zip with each entry deflated, like most ROM and save zips. */
export function makeZip(entries: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, comp);
    centrals.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export async function startServer(): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'romsafe-test-'));
  const config = loadConfig({
    ROMSAFE_DATA_DIR: path.join(dir, 'data'),
    ROMSAFE_PROFILES_DIR: path.join(repoRoot, 'profiles'),
    ROMSAFE_WEB_DIR: path.join(dir, 'no-web'),
  });
  const { app, services } = await buildApp(config);

  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse' } });
  const cookie = String(setup.headers['set-cookie']).split(';')[0]!;

  const admin = async (method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { cookie } });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };

  const pairDevice = async (name: string): Promise<TestDevice> => {
    const { body: code } = await admin('POST', '/api/devices/pairing-code');
    const res = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { code: code.code, name, kind: 'android' } });
    const { token, deviceId } = res.json();
    const headers = { authorization: `Bearer ${token}` };
    return {
      id: deviceId,
      headers,
      call: async (method, url, payload) => {
        const r = await app.inject({ method: method as any, url, payload: payload as any, headers });
        return { status: r.statusCode, body: r.body ? r.json() : null };
      },
      upload: async (platform, savePath, data, base, conflict) => {
        const qs = new URLSearchParams({ platform, path: savePath });
        if (base !== null) qs.set('base', String(base));
        if (conflict) qs.set('conflict', '1');
        const r = await app.inject({
          method: 'PUT',
          url: `/api/device/saves/upload?${qs}`,
          payload: data,
          headers: { ...headers, 'content-type': 'application/octet-stream' },
        });
        if (r.statusCode !== 200) throw new Error(`upload failed ${r.statusCode}: ${r.body}`);
        return r.json();
      },
      download: async (versionId) => {
        const r = await app.inject({ method: 'GET', url: `/api/save-versions/${versionId}/download`, headers });
        if (r.statusCode !== 200) throw new Error(`download failed ${r.statusCode}`);
        return r.rawPayload;
      },
    };
  };

  return {
    app,
    services,
    dir,
    cookie,
    admin,
    pairDevice,
    close: async () => {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
