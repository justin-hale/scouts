import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Services } from '../app.js';
import { requireAdmin } from '../auth.js';
import { classifyFiles } from '../library/scanner.js';
import { isSafeRelative, normalizePath } from '../profiles/template.js';

const MAX_SAVE_UPLOAD = 256 * 1024 * 1024;

/**
 * Uploads from the web GUI: ROMs into a platform's ROM folder, saves onto a
 * game, and cover images. Bodies are sent raw (application/octet-stream)
 * with names in the query string, so multi-GB ROMs stream straight to disk.
 */
export const uploadRoutes =
  ({ ctx, sync, scanner, metadata }: Services): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', requireAdmin);
    // Leave the body unread here so each route decides whether to stream or buffer it.
    app.removeContentTypeParser('application/octet-stream');
    app.addContentTypeParser('application/octet-stream', (_req, _payload, done) => done(null));

    app.put<{ Querystring: { platform?: string; path?: string; replace?: string } }>('/roms/upload', async (req, reply) => {
      const pc = ctx.platform(req.query.platform ?? '');
      if (!pc) return reply.code(404).send({ error: 'Unknown platform' });
      if (!pc.romPath) return reply.code(400).send({ error: `Set the ${pc.def.name} ROM folder first (Platforms)` });
      const rel = normalizePath(req.query.path ?? '');
      if (!isSafeRelative(rel) || rel.split('/').some((s) => s.startsWith('.'))) return reply.code(400).send({ error: 'Bad file name' });
      const { roms, extras } = classifyFiles(pc.def.romExtensions, pc.romPath, [rel]);
      if (!roms.length && !extras.length) {
        return reply.code(400).send({
          error: `"${path.posix.basename(rel)}" isn't a ${pc.def.name} ROM (${pc.def.romExtensions.join(' ')}). Put other files in a side folder such as mod/ or dlc/.`,
        });
      }
      const dest = path.join(pc.romPath, ...rel.split('/'));
      const replace = req.query.replace === '1' || req.query.replace === 'true';
      if (fs.existsSync(dest) && !replace) return reply.code(409).send({ error: `${rel} already exists` });

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // ".tmp" files are skipped by the scanner, so a half-written ROM never gets indexed.
      const tmp = `${dest}.romsafe-${process.pid}-${Date.now()}.tmp`;
      try {
        await pipeline(req.raw, fs.createWriteStream(tmp));
        fs.renameSync(tmp, dest);
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      scanner.scanSoon(pc.def.slug);
      return { ok: true, path: rel };
    });

    app.put<{ Params: { id: string }; Querystring: { name?: string } }>('/games/:id/saves/upload', async (req, reply) => {
      const name = req.query.name?.trim();
      if (!name) return reply.code(400).send({ error: 'Missing file name' });
      const data = await readBody(req, MAX_SAVE_UPLOAD);
      const changed = sync.store.importUpload(Number(req.params.id), name, data);
      return { ok: true, changed };
    });

    app.put<{ Params: { id: string } }>('/games/:id/cover/upload', async (req) => {
      await metadata.setCoverFromUpload(Number(req.params.id), await readBody(req, 20 * 1024 * 1024));
      return { ok: true };
    });
  };

async function readBody(req: FastifyRequest, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.raw) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error('Upload is too large'), { statusCode: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
