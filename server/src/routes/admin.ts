import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Services } from '../app.js';
import { requireAdmin, requireAdminOrDevice } from '../auth.js';
import { now } from '../db.js';
import type { Candidate } from '../metadata/providers.js';
import { PLATFORMS } from '../platforms.js';
import { profileSupports, validateLayout } from '../profiles/profiles.js';
import { setManualMatch } from '../roms/matching.js';
import { LibraryRemover } from '../library/remove.js';
import type { RomPart } from '../library/scanner.js';
import { zipFilesStream, zipStream } from '../library/zip.js';
import { downloadName } from '../saves/content.js';
import { saveLabel } from '../saves/labels.js';
import type { SaveRow } from '../saves/store.js';
import { PUBLIC_SETTINGS, publicSettings, setSetting } from '../settings.js';

type IdParams = { Params: { id: string } };

const int = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw Object.assign(new Error('Invalid id'), { statusCode: 400 });
  return n;
};

const notFound = (reply: FastifyReply, what = 'Not found') => reply.code(404).send({ error: what });

// Games list by platform in catalog order (the order of the GUI's platform chips), then by title.
const PLATFORM_ORDER = `CASE g.platform ${PLATFORMS.map((p, i) => `WHEN '${p.slug}' THEN ${i}`).join(' ')} ELSE ${PLATFORMS.length} END`;

export const adminRoutes =
  ({ ctx, sync, scanner, metadata }: Services): FastifyPluginAsync =>
  async (app) => {
    const db = ctx.db;
    const remover = new LibraryRemover(ctx, sync.store);

    /** Extra fields the GUI shows for a save: its download name and whether it's empty. */
    const describeSave = <T extends { platform: string; gameKey: string; file: string; sha256: string | null }>(s: T) => ({
      ...s,
      downloadName: downloadName(s.platform, s.gameKey, s.file),
      empty: s.sha256 ? sync.store.isEmptyVersion(s.platform, s.sha256) : false,
      // The copy in the platform's save folder (null when no save folder is set).
      serverPath: sync.store.serverPath({ platform: s.platform, game_key: s.gameKey, file: s.file } as SaveRow),
    });

    // Endpoints shared with devices: ROM and save version downloads.
    app.register(async (shared) => {
      shared.addHook('preHandler', requireAdminOrDevice);

      shared.get<IdParams>('/roms/:id/download', async (req, reply) => {
        const rom = db.get<{
          platform: string;
          rel_path: string;
          file_name: string;
          stem: string;
          size: number;
          mtime: number;
          crc32: string | null;
          parts: string | null;
        }>(
          'SELECT platform, rel_path, file_name, stem, size, mtime, crc32, parts FROM roms WHERE id = $id AND missing = 0',
          { $id: int(req.params.id) },
        );
        const root = rom && ctx.platform(rom.platform)?.romPath;
        if (!rom || !root) return notFound(reply, 'ROM not found');
        if (rom.parts) {
          // A .cue and its tracks (or an .m3u and its discs) only work together: send the set as one zip,
          // with paths relative to the ROM's folder.
          const dir = path.posix.dirname(rom.rel_path);
          const inZip = (rel: string) => (dir === '.' ? rel : path.posix.relative(dir, rel));
          const parts = JSON.parse(rom.parts) as RomPart[];
          const files = [
            { name: rom.file_name, path: path.join(root, rom.rel_path), size: rom.size, mtime: rom.mtime, crc32: rom.crc32 ?? undefined },
            ...parts.map((p) => ({ name: inZip(p.path), path: path.join(root, p.path), size: p.size, mtime: p.mtime, crc32: p.crc32 })),
          ];
          reply.header('Content-Type', 'application/zip');
          reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${rom.stem}.zip`)}`);
          return reply.send(zipFilesStream(files));
        }
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rom.file_name)}`);
        return reply.sendFile(rom.rel_path, root, { dotfiles: 'allow', cacheControl: false });
      });

      shared.get<IdParams>('/extras/:id/download', async (req, reply) => {
        const extra = db.get<{ platform: string; rel_path: string; file_name: string }>(
          'SELECT platform, rel_path, file_name FROM extras WHERE id = $id AND missing = 0',
          { $id: int(req.params.id) },
        );
        const root = extra && ctx.platform(extra.platform)?.romPath;
        if (!extra || !root) return notFound(reply, 'File not found');
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(extra.file_name)}`);
        return reply.sendFile(extra.rel_path, root, { dotfiles: 'allow', cacheControl: false });
      });

      shared.get<IdParams>('/save-versions/:id/download', async (req, reply) => {
        const v = sync.store.getVersion(int(req.params.id));
        if (!v) return notFound(reply);
        const save = sync.store.getSave(v.save_id)!;
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('X-Save-Sha256', v.sha256);
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName(save.platform, save.game_key, save.file))}`);
        return reply.send(fs.createReadStream(sync.store.blobPath(v.sha256)));
      });
    });

    // Everything else is for the web GUI only.
    app.register(async (admin) => {
      admin.addHook('preHandler', requireAdmin);

      admin.get('/stats', async () => ({
        games: db.get<{ n: number }>('SELECT count(*) AS n FROM games')!.n,
        roms: db.get<{ n: number }>('SELECT count(*) AS n FROM roms WHERE missing = 0')!.n,
        saves: db.get<{ n: number }>('SELECT count(*) AS n FROM saves WHERE current_version_id IS NOT NULL')!.n,
        devices: db.get<{ n: number }>('SELECT count(*) AS n FROM devices')!.n,
        openConflicts: db.get<{ n: number }>('SELECT count(*) AS n FROM conflicts WHERE resolved_at IS NULL')!.n,
      }));

      // --- platforms & profiles -------------------------------------------

      admin.get('/platforms', async () => {
        const counts = (sql: string) => new Map(db.all<{ platform: string; n: number }>(sql).map((r) => [r.platform, r.n]));
        const games = counts('SELECT platform, count(*) AS n FROM games GROUP BY platform');
        const roms = counts('SELECT platform, count(*) AS n FROM roms WHERE missing = 0 GROUP BY platform');
        const saves = counts('SELECT platform, count(*) AS n FROM saves WHERE current_version_id IS NOT NULL GROUP BY platform');
        const extras = counts('SELECT platform, count(*) AS n FROM extras WHERE missing = 0 GROUP BY platform');
        return ctx.platforms().map((p) => ({
          slug: p.def.slug,
          name: p.def.name,
          keyKind: p.def.keyKind,
          romExtensions: p.def.romExtensions,
          enabled: p.enabled,
          romPath: p.romPath,
          savePath: p.savePath,
          saveLayout: p.saveLayout,
          saveLayoutOverride: p.saveLayoutOverride,
          defaultSaveLayout: p.def.defaultSaveLayout,
          profiles: ctx.profiles.filter((pr) => profileSupports(pr, p.def)).map((pr) => pr.id),
          counts: {
            games: games.get(p.def.slug) ?? 0,
            roms: roms.get(p.def.slug) ?? 0,
            saves: saves.get(p.def.slug) ?? 0,
            extras: extras.get(p.def.slug) ?? 0,
          },
        }));
      });

      admin.put<{ Params: { slug: string }; Body: { enabled?: boolean; romPath?: string | null; savePath?: string | null; saveLayout?: string | null } }>(
        '/platforms/:slug',
        async (req, reply) => {
          const pc = ctx.platform(req.params.slug);
          if (!pc) return notFound(reply, 'Unknown platform');
          const b = req.body ?? {};
          const clean = (v: string | null | undefined, current: string | null) => (v === undefined ? current : v?.trim() || null);
          const romPath = clean(b.romPath, pc.romPath);
          const savePath = clean(b.savePath, pc.savePath);
          const saveLayout = clean(b.saveLayout, pc.saveLayoutOverride);
          for (const p of [romPath, savePath]) {
            if (p && !path.isAbsolute(p)) return reply.code(400).send({ error: `Paths must be absolute (got "${p}")` });
          }
          if (saveLayout) {
            const problem = validateLayout(pc.def, saveLayout);
            if (problem) return reply.code(400).send({ error: problem });
          }
          db.run(
            `INSERT INTO platforms (slug, enabled, rom_path, save_path, save_layout) VALUES ($s, $e, $r, $sp, $l)
             ON CONFLICT(slug) DO UPDATE SET enabled = excluded.enabled, rom_path = excluded.rom_path,
               save_path = excluded.save_path, save_layout = excluded.save_layout`,
            { $s: pc.def.slug, $e: (b.enabled ?? pc.enabled) ? 1 : 0, $r: romPath, $sp: savePath, $l: saveLayout },
          );
          return { ok: true };
        },
      );

      admin.get('/profiles', async () =>
        ctx.profiles.map((p) => ({
          ...p,
          platforms: ctx.platforms().filter((pc) => profileSupports(p, pc.def)).map((pc) => pc.def.slug),
        })),
      );

      // --- library ------------------------------------------------------------

      admin.post<{ Body: { platforms?: string[] } }>('/library/scan', async (req, reply) => {
        if (!scanner.start(req.body?.platforms)) return reply.code(409).send({ error: 'A scan is already running' });
        return scanner.status;
      });
      admin.get('/library/scan', async () => scanner.status);

      admin.post<{ Body: { platform?: string; force?: boolean } }>('/metadata/scrape', async (req, reply) => {
        if (!metadata.startScrapeAll(req.body?.platform, req.body?.force)) return reply.code(409).send({ error: 'Already scraping' });
        return metadata.scrape;
      });
      admin.get('/metadata/scrape', async () => metadata.scrape);

      admin.get<{ Querystring: { platform?: string; q?: string; limit?: string; offset?: string } }>('/games', async (req) => {
        const { platform, q } = req.query;
        const limit = Math.min(Number(req.query.limit ?? 120), 500);
        const offset = Number(req.query.offset ?? 0);
        const where: string[] = ['1=1'];
        const params: Record<string, string | number> = {};
        if (platform) (where.push('g.platform = $p'), (params.$p = platform));
        if (q) (where.push('g.title LIKE $q'), (params.$q = `%${q}%`));
        const total = db.get<{ n: number }>(`SELECT count(*) AS n FROM games g WHERE ${where.join(' AND ')}`, params)!.n;
        const items = db.all(
          `SELECT g.id, g.platform, g.title, g.release_date AS releaseDate, g.cover_file AS cover,
             (SELECT count(*) FROM roms r WHERE r.game_id = g.id AND r.missing = 0) AS romCount,
             (SELECT count(*) FROM saves s WHERE s.game_id = g.id AND s.current_version_id IS NOT NULL) AS saveCount
           FROM games g WHERE ${where.join(' AND ')} ORDER BY ${PLATFORM_ORDER}, g.title COLLATE NOCASE LIMIT $limit OFFSET $offset`,
          { ...params, $limit: limit, $offset: offset },
        );
        return { items, total };
      });

      admin.get<IdParams>('/games/:id', async (req, reply) => {
        const id = int(req.params.id);
        const game = db.get(
          `SELECT id, platform, title, title_id AS titleId, igdb_id AS igdbId, sgdb_id AS sgdbId, summary,
             release_date AS releaseDate, cover_file AS cover, metadata_source AS metadataSource FROM games WHERE id = $id`,
          { $id: id },
        );
        if (!game) return notFound(reply);
        // Where files live, as the server sees them (container paths), for the GUI to show on hover.
        const romRoot = ctx.platform((game as { platform: string }).platform)?.romPath;
        const onServer = (rel: string) => (romRoot ? path.join(romRoot, rel) : null);
        const roms = db
          .all<{ relPath: string; size: number; totalSize: number | null; parts: string | null }>(
            `SELECT id, rel_path AS relPath, file_name AS fileName, size, total_size AS totalSize, parts,
               crc32, md5, sha1, title_id AS titleId, missing
             FROM roms WHERE game_id = $id ORDER BY file_name`,
            { $id: id },
          )
          .map((r) => ({
            ...r,
            totalSize: r.totalSize ?? r.size,
            parts: ((r.parts ? JSON.parse(r.parts) : []) as RomPart[]).map((p) => ({ path: p.path, size: p.size, serverPath: onServer(p.path) })),
            serverPath: onServer(r.relPath),
          }));
        const saves = db
          .all<{ platform: string; gameKey: string; file: string; sha256: string | null }>(
            `SELECT s.id, s.platform, s.game_key AS gameKey, s.file, s.current_version_id AS currentVersionId,
               v.sha256, v.size, v.created_at AS updatedAt, d.name AS updatedBy,
               (SELECT count(*) FROM save_versions x WHERE x.save_id = s.id) AS versionCount
             FROM saves s
             LEFT JOIN save_versions v ON v.id = s.current_version_id
             LEFT JOIN devices d ON d.id = v.device_id
             WHERE s.game_id = $id ORDER BY s.file`,
            { $id: id },
          )
          .map(describeSave);
        const extras = db
          .all<{ relPath: string }>(
            `SELECT id, kind, rel_path AS relPath, file_name AS fileName, size, missing
             FROM extras WHERE game_id = $id ORDER BY kind, rel_path`,
            { $id: id },
          )
          .map((x) => ({ ...x, serverPath: onServer(x.relPath) }));
        return { ...game, roms, saves, extras };
      });

      admin.patch<IdParams & { Body: { title?: string; summary?: string | null; titleId?: string | null } }>(
        '/games/:id',
        async (req, reply) => {
          const id = int(req.params.id);
          const b = req.body ?? {};
          const { changes } = db.run(
            `UPDATE games SET title = COALESCE($t, title),
               summary = CASE WHEN $setSummary THEN $s ELSE summary END,
               title_id = CASE WHEN $setTid THEN $tid ELSE title_id END,
               updated_at = $now WHERE id = $id`,
            {
              $t: b.title?.trim() || null,
              $setSummary: b.summary !== undefined ? 1 : 0,
              $s: b.summary ?? null,
              $setTid: b.titleId !== undefined ? 1 : 0,
              $tid: b.titleId?.trim().toLowerCase() || null,
              $now: now(),
              $id: id,
            },
          );
          if (!changes) return notFound(reply);
          sync.store.relinkSaves();
          return { ok: true };
        },
      );

      admin.post<IdParams & { Body: { query?: string } }>('/games/:id/metadata/search', async (req) =>
        metadata.search(int(req.params.id), req.body?.query),
      );
      admin.post<IdParams & { Body: { provider: Candidate['provider']; id: number } }>('/games/:id/metadata/apply', async (req) => {
        await metadata.apply(int(req.params.id), req.body.provider, int(req.body.id));
        return { ok: true };
      });
      admin.post<IdParams>('/games/:id/metadata/auto', async (req) => ({ changed: await metadata.auto(int(req.params.id)) }));
      admin.get<IdParams & { Querystring: { q?: string } }>('/games/:id/covers', async (req) =>
        metadata.coverOptions(int(req.params.id), req.query.q),
      );
      admin.post<IdParams & { Body: { url: string } }>('/games/:id/cover', async (req) => {
        await metadata.setCoverFromUrl(int(req.params.id), String(req.body?.url ?? ''));
        return { ok: true };
      });

      admin.get<{ Params: { file: string } }>('/covers/:file', async (req, reply) => {
        if (!/^[\w-]+\.(jpg|png|webp)$/.test(req.params.file)) return notFound(reply);
        return reply.sendFile(req.params.file, ctx.coverDir, { maxAge: '30d', immutable: true });
      });

      // --- saves & conflicts ---------------------------------------------------

      admin.get<{ Querystring: { platform?: string } }>('/saves', async (req) =>
        db
          .all<{ platform: string; gameKey: string; file: string; gameId: number | null; sha256: string }>(
            `SELECT s.id, s.platform, s.game_key AS gameKey, s.file, s.current_version_id AS currentVersionId,
               g.id AS gameId, g.title AS gameTitle, v.sha256, v.size, v.created_at AS updatedAt, d.name AS updatedBy,
               (SELECT count(*) FROM save_versions x WHERE x.save_id = s.id) AS versionCount
             FROM saves s
             LEFT JOIN games g ON g.id = s.game_id
             LEFT JOIN save_versions v ON v.id = s.current_version_id
             LEFT JOIN devices d ON d.id = v.device_id
             WHERE s.current_version_id IS NOT NULL AND ($p IS NULL OR s.platform = $p)
             ORDER BY s.platform, COALESCE(g.title, s.game_key) COLLATE NOCASE, s.file`,
            { $p: req.query.platform ?? null },
          )
          .map((s) => ({ ...describeSave(s), label: s.gameId ? null : saveLabel(s.platform, s.file, sync.store.blobPath(s.sha256)) })),
      );

      // Current saves as a zip: everything, one platform, or one game; laid out for an emulator profile if given.
      admin.get<{ Querystring: { platform?: string; gameId?: string; profile?: string } }>('/saves/export.zip', async (req, reply) => {
        const { platform, profile: profileId } = req.query;
        const gameId = req.query.gameId ? int(req.query.gameId) : undefined;
        const profile = profileId ? ctx.profile(profileId) : undefined;
        if (profileId && !profile) return notFound(reply, 'Unknown profile');
        let name = 'romsafe-saves';
        if (gameId) {
          const g = db.get<{ title: string }>('SELECT title FROM games WHERE id = $id', { $id: gameId });
          if (!g) return notFound(reply, 'Game not found');
          name = `${g.title} saves`;
        } else if (platform) name = `romsafe-saves-${platform}`;
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${name.replace(/[\\/:*?"<>|]/g, '_')}.zip`)}`);
        return reply.send(zipStream(sync.store.exportEntries({ platform, gameId, profile })));
      });

      admin.delete<IdParams>('/saves/:id', async (req, reply) => {
        if (!sync.store.deleteSave(int(req.params.id))) return notFound(reply, 'Save not found');
        return { ok: true };
      });

      admin.delete<IdParams>('/roms/:id', async (req) => remover.deleteRom(int(req.params.id)));

      admin.delete<IdParams & { Querystring: { saves?: string } }>('/games/:id', async (req) =>
        remover.deleteGame(int(req.params.id), { saves: req.query.saves === '1' || req.query.saves === 'true' }),
      );

      admin.get<IdParams>('/saves/:id/versions', async (req) =>
        db.all(
          `SELECT v.id, v.sha256, v.size, v.created_at AS createdAt, v.note, v.parent_version_id AS parentVersionId,
             d.name AS device, (s.current_version_id = v.id) AS isCurrent
           FROM save_versions v JOIN saves s ON s.id = v.save_id LEFT JOIN devices d ON d.id = v.device_id
           WHERE v.save_id = $id ORDER BY v.id DESC`,
          { $id: int(req.params.id) },
        ),
      );

      admin.post<IdParams & { Body: { versionId: number } }>('/saves/:id/restore', async (req, reply) => {
        const saveId = int(req.params.id);
        const v = sync.store.getVersion(int(req.body?.versionId));
        if (!v || v.save_id !== saveId) return notFound(reply, 'Version not found');
        sync.store.setCurrent(saveId, v.id);
        return { ok: true };
      });

      admin.get<{ Querystring: { all?: string } }>('/conflicts', async (req) =>
        db.all(
          `SELECT c.id, c.save_id AS saveId, c.created_at AS createdAt, c.resolved_at AS resolvedAt, c.resolution,
             s.platform, s.file, s.game_key AS gameKey, g.title AS gameTitle, g.id AS gameId, d.name AS device,
             sv.id AS serverVersionId, sv.size AS serverSize, sv.created_at AS serverCreatedAt,
             sv.file_mtime AS serverFileMtime, sv.note AS serverNote, sd.name AS serverDevice,
             (SELECT m.save_root FROM device_mappings m
               WHERE m.device_id = sv.device_id AND m.platform = s.platform AND m.slot = COALESCE(sv.slot, '')) AS serverFolder,
             dv.id AS deviceVersionId, dv.size AS deviceSize, dv.created_at AS deviceCreatedAt, dv.file_mtime AS deviceFileMtime,
             (SELECT m.save_root FROM device_mappings m
               WHERE m.device_id = c.device_id AND m.platform = s.platform AND m.slot = c.slot) AS deviceFolder
           FROM conflicts c JOIN saves s ON s.id = c.save_id
           LEFT JOIN games g ON g.id = s.game_id LEFT JOIN devices d ON d.id = c.device_id
           JOIN save_versions sv ON sv.id = c.server_version_id JOIN save_versions dv ON dv.id = c.device_version_id
           LEFT JOIN devices sd ON sd.id = sv.device_id
           WHERE ($all = 1 OR c.resolved_at IS NULL) ORDER BY c.id DESC`,
          { $all: req.query.all ? 1 : 0 },
        ),
      );

      admin.post<IdParams & { Body: { keep: 'server' | 'device' } }>('/conflicts/:id/resolve', async (req, reply) => {
        const keep = req.body?.keep;
        if (keep !== 'server' && keep !== 'device') return reply.code(400).send({ error: 'keep must be "server" or "device"' });
        sync.resolveConflict(int(req.params.id), keep);
        return { ok: true };
      });

      // --- devices ------------------------------------------------------------------

      admin.get('/devices', async () =>
        db.all(
          `SELECT d.id, d.name, d.kind, d.created_at AS createdAt, d.last_seen_at AS lastSeenAt,
             (SELECT count(*) FROM device_mappings m WHERE m.device_id = d.id) AS mappings,
             (SELECT count(*) FROM device_rom_queue q WHERE q.device_id = d.id) AS queued
           FROM devices d ORDER BY d.name`,
        ),
      );

      admin.post('/devices/pairing-code', async () => ctx.auth.createPairingCode());

      admin.patch<IdParams & { Body: { name: string } }>('/devices/:id', async (req, reply) => {
        const name = req.body?.name?.trim();
        if (!name) return reply.code(400).send({ error: 'Name required' });
        const { changes } = db.run('UPDATE devices SET name = $n WHERE id = $id', { $n: name, $id: int(req.params.id) });
        return changes ? { ok: true } : notFound(reply);
      });

      admin.delete<IdParams>('/devices/:id', async (req, reply) => {
        const { changes } = db.run('DELETE FROM devices WHERE id = $id', { $id: int(req.params.id) });
        return changes ? { ok: true } : notFound(reply);
      });

      admin.get<IdParams>('/devices/:id', async (req, reply) => {
        const id = int(req.params.id);
        const device = db.get('SELECT id, name, kind, created_at AS createdAt, last_seen_at AS lastSeenAt FROM devices WHERE id = $id', {
          $id: id,
        });
        if (!device) return notFound(reply);
        const mappings = db.all(
          'SELECT platform, slot, profile, save_root AS saveRoot, rom_root AS romRoot FROM device_mappings WHERE device_id = $id ORDER BY platform, slot',
          { $id: id },
        );
        const romSummary = db.all(
          `SELECT platform, count(*) AS files, count(rom_id) AS matched FROM device_roms WHERE device_id = $id GROUP BY platform`,
          { $id: id },
        );
        return { ...device, mappings, romSummary };
      });

      admin.get<IdParams & { Querystring: { platform: string } }>('/devices/:id/roms', async (req) => {
        const id = int(req.params.id);
        const platform = req.query.platform;
        const serverRoms = db.all(
          `SELECT r.id AS romId, r.file_name AS fileName, r.size, g.title AS gameTitle, g.id AS gameId,
             (SELECT dr.local_path FROM device_roms dr WHERE dr.device_id = $d AND dr.rom_id = r.id LIMIT 1) AS localPath,
             EXISTS (SELECT 1 FROM device_rom_queue q WHERE q.device_id = $d AND q.rom_id = r.id) AS queued
           FROM roms r LEFT JOIN games g ON g.id = r.game_id
           WHERE r.platform = $p AND r.missing = 0 ORDER BY r.file_name COLLATE NOCASE`,
          { $d: id, $p: platform },
        );
        const unmatched = db.all(
          `SELECT id, local_path AS localPath, size, match_kind AS matchKind FROM device_roms
           WHERE device_id = $d AND platform = $p AND rom_id IS NULL ORDER BY local_path`,
          { $d: id, $p: platform },
        );
        return { serverRoms, unmatched };
      });

      admin.put<{ Params: { id: string; deviceRomId: string }; Body: { romId: number | null } }>(
        '/devices/:id/roms/:deviceRomId',
        async (req, reply) => {
          const romId = req.body?.romId == null ? null : int(req.body.romId);
          return setManualMatch(db, int(req.params.id), int(req.params.deviceRomId), romId) ? { ok: true } : notFound(reply);
        },
      );

      admin.post<IdParams & { Body: { romIds: number[] } }>('/devices/:id/queue', async (req) => {
        const id = int(req.params.id);
        db.tx(() => {
          for (const romId of req.body?.romIds ?? []) {
            db.run('INSERT OR IGNORE INTO device_rom_queue (device_id, rom_id, requested_at) VALUES ($d, $r, $t)', {
              $d: id,
              $r: int(romId),
              $t: now(),
            });
          }
        });
        return { ok: true };
      });

      admin.delete<{ Params: { id: string; romId: string } }>('/devices/:id/queue/:romId', async (req) => {
        db.run('DELETE FROM device_rom_queue WHERE device_id = $d AND rom_id = $r', { $d: int(req.params.id), $r: int(req.params.romId) });
        return { ok: true };
      });

      // --- settings ---------------------------------------------------------------

      admin.get('/settings', async () => publicSettings(db));

      admin.put<{ Body: Record<string, string | null> }>('/settings', async (req, reply) => {
        for (const [key, value] of Object.entries(req.body ?? {})) {
          if (!(key in PUBLIC_SETTINGS)) return reply.code(400).send({ error: `Unknown setting "${key}"` });
          setSetting(db, key, value === null ? null : String(value).trim());
        }
        return publicSettings(db);
      });
    });
  };
