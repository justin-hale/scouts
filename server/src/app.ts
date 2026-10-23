import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Auth } from './auth.js';
import type { Config } from './config.js';
import { AppContext } from './context.js';
import { Db } from './db.js';
import { Scanner } from './library/scanner.js';
import { MetadataService } from './metadata/service.js';
import { loadProfiles } from './profiles/profiles.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/device.js';
import { uploadRoutes } from './routes/uploads.js';
import { SyncError, SyncService } from './saves/sync.js';

export interface Services {
  ctx: AppContext;
  sync: SyncService;
  scanner: Scanner;
  metadata: MetadataService;
}

export async function buildApp(config: Config, opts: { logger?: boolean } = {}): Promise<{ app: FastifyInstance; services: Services }> {
  const db = new Db(path.join(config.dataDir, 'romsafe.db'));
  const ctx = new AppContext(config, db, new Auth(db, config.adminPassword), loadProfiles(config.profilesDir));
  const services: Services = {
    ctx,
    sync: new SyncService(ctx),
    scanner: new Scanner(ctx),
    metadata: new MetadataService(ctx),
  };

  // Save uploads can be large (3DS extdata, PSP saves). ROM uploads stream
  // to disk and skip this limit (routes/uploads.ts).
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024 * 1024 });
  app.addHook('onClose', async () => db.close());

  await app.register(cookie);
  const hasWeb = fs.existsSync(path.join(config.webDir, 'index.html'));
  // Also provides reply.sendFile, used for ranged ROM downloads.
  await app.register(fastifyStatic, { root: hasWeb ? config.webDir : config.dataDir, serve: hasWeb, wildcard: false });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addHook('onRequest', async (req) => ctx.auth.identify(req));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SyncError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true, name: 'romsafe', version: '0.1.0' }));
  await app.register(authRoutes(services), { prefix: '/api/auth' });
  await app.register(adminRoutes(services), { prefix: '/api' });
  await app.register(uploadRoutes(services), { prefix: '/api' });
  await app.register(deviceRoutes(services), { prefix: '/api/device' });

  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });

  return { app, services };
}
