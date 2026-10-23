import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../app.js';
import { requireDevice } from '../auth.js';
import { now } from '../db.js';
import { profileSupports } from '../profiles/profiles.js';
import { isSafeRelative, normalizePath } from '../profiles/template.js';
import { updateInventory, type InventoryFile } from '../roms/matching.js';
import type { LocalSave } from '../saves/sync.js';

interface MappingBody {
  platform: string;
  /** Which of the device's emulators for this platform; '' (the default) is the first. */
  slot?: string;
  profile: string;
  saveRoot?: string | null;
  romRoot?: string | null;
}

/** API used by the Android and Windows clients. See docs/sync-protocol.md. */
export const deviceRoutes =
  ({ ctx, sync }: Services): FastifyPluginAsync =>
  async (app) => {
    const db = ctx.db;

    app.post<{ Body: { code: string; name: string; kind: string } }>('/pair', async (req, reply) => {
      const { code, name, kind } = req.body ?? ({} as { code?: string; name?: string; kind?: string });
      if (!code || !name?.trim()) return reply.code(400).send({ error: 'code and name are required' });
      const result = ctx.auth.pair(code, name.trim(), kind?.trim() || 'unknown');
      if (!result) return reply.code(401).send({ error: 'Pairing code is invalid or expired' });
      return { deviceId: result.device.id, token: result.token };
    });

    app.register(async (dev) => {
      dev.addHook('preHandler', requireDevice);

      dev.get('/config', async (req) => {
        const deviceId = req.device!.id;
        return {
          device: req.device,
          platforms: ctx
            .platforms()
            .filter((p) => p.enabled)
            .map((p) => ({
              slug: p.def.slug,
              name: p.def.name,
              keyKind: p.def.keyKind,
              romExtensions: p.def.romExtensions,
              profiles: ctx.profiles.filter((pr) => profileSupports(pr, p.def)).map((pr) => pr.id),
            })),
          profiles: ctx.profiles,
          mappings: db.all(
            'SELECT platform, slot, profile, save_root AS saveRoot, rom_root AS romRoot FROM device_mappings WHERE device_id = $d ORDER BY platform, slot',
            { $d: deviceId },
          ),
        };
      });

      /** Replace the device's folder mappings. */
      dev.put<{ Body: { mappings: MappingBody[] } }>('/mappings', async (req, reply) => {
        const mappings = req.body?.mappings ?? [];
        const seen = new Set<string>();
        for (const m of mappings) {
          m.slot = String(m.slot ?? '').trim();
          if (m.slot.length > 32) return reply.code(400).send({ error: 'slot is too long' });
          const id = `${m.platform}/${m.slot}`;
          if (seen.has(id)) return reply.code(400).send({ error: `Duplicate mapping for ${m.platform} slot "${m.slot}"` });
          seen.add(id);
          const pc = ctx.platform(m.platform);
          const profile = ctx.profile(m.profile);
          if (!pc || !profile) return reply.code(400).send({ error: `Unknown platform or profile: ${m.platform}/${m.profile}` });
          if (!profileSupports(profile, pc.def)) {
            return reply.code(400).send({ error: `Profile ${profile.id} does not support ${pc.def.slug}` });
          }
        }
        const deviceId = req.device!.id;
        db.tx(() => {
          db.run('DELETE FROM device_mappings WHERE device_id = $d', { $d: deviceId });
          for (const m of mappings) {
            db.run(
              'INSERT INTO device_mappings (device_id, platform, slot, profile, save_root, rom_root) VALUES ($d, $p, $slot, $pr, $s, $r)',
              { $d: deviceId, $p: m.platform, $slot: m.slot ?? '', $pr: m.profile, $s: m.saveRoot ?? null, $r: m.romRoot ?? null },
            );
          }
        });
        return { ok: true };
      });

      // --- ROMs -----------------------------------------------------------------

      dev.post<{ Body: { platform: string; files: InventoryFile[]; complete?: boolean } }>('/roms/inventory', async (req, reply) => {
        const { platform, files, complete = true } = req.body ?? ({} as never);
        if (!ctx.platform(platform)) return reply.code(400).send({ error: 'Unknown platform' });
        if (!Array.isArray(files)) return reply.code(400).send({ error: 'files must be a list' });
        for (const f of files) {
          if (!isSafeRelative(normalizePath(String(f.path))) || !Number.isFinite(f.size)) {
            return reply.code(400).send({ error: `Bad file entry: ${JSON.stringify(f)}` });
          }
        }
        const results = updateInventory(db, req.device!.id, platform, files, complete);
        return { results };
      });

      /** Server ROMs for a platform, flagged with whether this device has them. */
      dev.get<{ Querystring: { platform: string } }>('/roms', async (req) =>
        db.all(
          `SELECT r.id, r.rel_path AS relPath, r.file_name AS fileName, r.size, r.sha1, g.title AS gameTitle,
             g.cover_file AS cover,
             (SELECT dr.local_path FROM device_roms dr WHERE dr.device_id = $d AND dr.rom_id = r.id LIMIT 1) AS localPath
           FROM roms r LEFT JOIN games g ON g.id = r.game_id
           WHERE r.platform = $p AND r.missing = 0 ORDER BY r.file_name COLLATE NOCASE`,
          { $d: req.device!.id, $p: req.query.platform },
        ),
      );

      /**
       * The server library for one platform, a game per entry with its ROMs, for
       * browsing and downloading on the device. `cover` is a file under /api/covers/.
       */
      dev.get<{ Querystring: { platform: string } }>('/games', async (req) => {
        const deviceId = req.device!.id;
        const platform = req.query.platform;
        const games = db.all<{ id: number; title: string; releaseDate: string | null; cover: string | null }>(
          `SELECT g.id, g.title, g.release_date AS releaseDate, g.cover_file AS cover
           FROM games g WHERE g.platform = $p
             AND EXISTS (SELECT 1 FROM roms r WHERE r.game_id = g.id AND r.missing = 0)
           ORDER BY g.title COLLATE NOCASE`,
          { $p: platform },
        );
        const roms = db.all<{
          id: number;
          gameId: number;
          fileName: string;
          relPath: string;
          size: number;
          totalSize: number | null;
          parts: string | null;
          localPath: string | null;
          queued: number;
        }>(
          `SELECT r.id, r.game_id AS gameId, r.file_name AS fileName, r.rel_path AS relPath, r.size,
             r.total_size AS totalSize, r.parts,
             (SELECT dr.local_path FROM device_roms dr WHERE dr.device_id = $d AND dr.rom_id = r.id LIMIT 1) AS localPath,
             EXISTS (SELECT 1 FROM device_rom_queue q WHERE q.device_id = $d AND q.rom_id = r.id) AS queued
           FROM roms r WHERE r.platform = $p AND r.missing = 0 AND r.game_id IS NOT NULL
           ORDER BY r.file_name COLLATE NOCASE`,
          { $d: deviceId, $p: platform },
        );
        const byGame = new Map<number, unknown[]>();
        for (const r of roms) {
          const list = byGame.get(r.gameId) ?? [];
          list.push({
            id: r.id,
            fileName: r.fileName,
            relPath: r.relPath,
            // What the download weighs: multi-file ROMs come as one zip of all their files.
            size: r.totalSize ?? r.size,
            multiFile: r.parts != null,
            localPath: r.localPath,
            queued: !!r.queued,
          });
          byGame.set(r.gameId, list);
        }
        return games.map((g) => ({ ...g, roms: byGame.get(g.id) ?? [] }));
      });

      dev.get('/roms/queue', async (req) =>
        db.all(
          `SELECT r.id, r.platform, r.rel_path AS relPath, r.file_name AS fileName, r.size, r.sha1,
             r.total_size AS totalSize, r.parts IS NOT NULL AS multiFile,
             '/api/roms/' || r.id || '/download' AS url
           FROM device_rom_queue q JOIN roms r ON r.id = q.rom_id
           WHERE q.device_id = $d AND r.missing = 0 ORDER BY q.requested_at`,
          { $d: req.device!.id },
        ),
      );

      dev.post<{ Body: { romIds: number[] } }>('/roms/queue', async (req) => {
        db.tx(() => {
          for (const romId of req.body?.romIds ?? []) {
            db.run('INSERT OR IGNORE INTO device_rom_queue (device_id, rom_id, requested_at) VALUES ($d, $r, $t)', {
              $d: req.device!.id,
              $r: Number(romId),
              $t: now(),
            });
          }
        });
        return { ok: true };
      });

      dev.delete<{ Params: { romId: string } }>('/roms/queue/:romId', async (req) => {
        db.run('DELETE FROM device_rom_queue WHERE device_id = $d AND rom_id = $r', { $d: req.device!.id, $r: Number(req.params.romId) });
        return { ok: true };
      });

      // --- saves ----------------------------------------------------------------

      dev.post<{ Body: { platform: string; slot?: string; files: LocalSave[] } }>('/saves/plan', async (req, reply) => {
        const { platform, slot = '', files } = req.body ?? ({} as never);
        if (!Array.isArray(files)) return reply.code(400).send({ error: 'files must be a list' });
        for (const f of files) {
          if (!isSafeRelative(normalizePath(String(f.path))) || !/^[0-9a-f]{64}$/i.test(String(f.sha256))) {
            return reply.code(400).send({ error: `Bad file entry: ${JSON.stringify(f)}` });
          }
        }
        return { actions: sync.plan(req.device!.id, platform, files, slot) };
      });

      dev.put<{
        Querystring: { platform: string; slot?: string; path: string; base?: string; conflict?: string; modified?: string };
        Body: Buffer;
      }>(
        '/saves/upload',
        async (req, reply) => {
          const { platform, slot = '', path, base, conflict, modified } = req.query;
          const fileMtime = Number(modified);
          if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'Send the file as application/octet-stream' });
          if (!path || !isSafeRelative(normalizePath(path))) return reply.code(400).send({ error: 'Bad path' });
          const baseVersionId = base ? Number(base) : null;
          return sync.upload(
            req.device!.id,
            platform,
            normalizePath(path),
            req.body,
            baseVersionId,
            conflict === '1' || conflict === 'true',
            slot,
            Number.isFinite(fileMtime) && fileMtime > 0 ? fileMtime : null,
          );
        },
      );

      dev.post<{ Body: { saveId: number; versionId: number; slot?: string } }>('/saves/ack', async (req) => {
        sync.ack(req.device!.id, Number(req.body?.saveId), Number(req.body?.versionId), req.body?.slot ?? '');
        return { ok: true };
      });
    });
  };
