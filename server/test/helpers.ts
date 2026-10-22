import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
