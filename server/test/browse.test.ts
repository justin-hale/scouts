import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startServer, type TestDevice, type TestServer } from './helpers.js';

// Browsing the library: the sort orders both clients share, and what paired devices may read.

let srv: TestServer;
let thor: TestDevice;

const roms: Record<string, string[]> = {
  gba: ['Advance Wars.gba', 'Metroid Fusion.gba', 'Zelda Minish Cap.gba'],
  nds: ['Pokemon Platinum.nds'],
  gbc: ['Tetris DX.gbc', 'Pokemon Crystal.gbc'],
};

const db = () => srv.services.ctx.db;
const gameId = (title: string) => db().get<{ id: number }>('SELECT id FROM games WHERE title = $t', { $t: title })!.id;
const titles = (items: { platform: string; title: string }[]) => items.map((g) => `${g.platform}:${g.title}`);

before(async () => {
  srv = await startServer();
  for (const [slug, files] of Object.entries(roms)) {
    const dir = path.join(srv.dir, 'roms', slug);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f), `rom ${f}`);
    await srv.admin('PUT', `/api/platforms/${slug}`, { romPath: dir, savePath: path.join(srv.dir, 'saves', slug) });
    await srv.services.scanner.run([srv.services.ctx.platform(slug)!]);
  }
  // Deterministic "added" and release dates.
  db().run("UPDATE games SET created_at = 1000 WHERE platform <> 'gba'");
  db().run("UPDATE games SET created_at = 2000 WHERE title = 'Advance Wars'");
  db().run("UPDATE games SET created_at = 3000 WHERE title = 'Zelda Minish Cap'");
  db().run("UPDATE games SET created_at = 1500 WHERE title = 'Metroid Fusion'");
  db().run("UPDATE games SET release_date = '2001-09-10' WHERE title = 'Advance Wars'");
  db().run("UPDATE games SET release_date = '2002-11-17' WHERE title = 'Metroid Fusion'");

  thor = await srv.pairDevice('Thor');
  assert.equal((await thor.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'gba', profile: 'retroarch' }] })).status, 200);
  const rom = Buffer.from('rom Metroid Fusion.gba');
  await thor.call('POST', '/api/device/roms/inventory', {
    platform: 'gba',
    files: [{ path: 'Metroid Fusion.gba', size: rom.length, sha1: crypto.createHash('sha1').update(rom).digest('hex') }],
  });
  await thor.upload('gba', 'Metroid Fusion.srm', Buffer.from('first save'), null);
});

after(() => srv.close());

test('platforms are listed alphabetically by name, or by game count', async () => {
  const names = (list: { slug: string; name: string }[]) => list.map((p) => p.name);
  const { body } = await srv.admin('GET', '/api/platforms');
  assert.deepEqual(names(body), [...names(body)].sort((a, b) => a.localeCompare(b)));
  assert.ok(names(body).indexOf('Dreamcast') < names(body).indexOf('Game Boy'));

  const byGames = await srv.admin('GET', '/api/platforms?sort=games');
  assert.deepEqual(byGames.body.slice(0, 3).map((p: { slug: string }) => p.slug), ['gba', 'gbc', 'nds']);
  assert.equal((await srv.admin('GET', '/api/platforms?sort=size')).status, 400);
});

test('games group by platform name by default, titles A-Z', async () => {
  const { body } = await srv.admin('GET', '/api/games');
  assert.deepEqual(titles(body.items), [
    'gba:Advance Wars',
    'gba:Metroid Fusion',
    'gba:Zelda Minish Cap',
    'gbc:Pokemon Crystal',
    'gbc:Tetris DX',
    'nds:Pokemon Platinum',
  ]);
});

test('games sort within each platform, and platforms can go by size', async () => {
  const list = async (qs: string) => titles((await srv.admin('GET', `/api/games?${qs}`)).body.items);
  assert.deepEqual(await list('platform=gba&sort=title-desc'), ['gba:Zelda Minish Cap', 'gba:Metroid Fusion', 'gba:Advance Wars']);
  assert.deepEqual(await list('platform=gba&sort=added'), ['gba:Zelda Minish Cap', 'gba:Advance Wars', 'gba:Metroid Fusion']);
  // Newest release first; unknown dates last.
  assert.deepEqual(await list('platform=gba&sort=released'), ['gba:Metroid Fusion', 'gba:Advance Wars', 'gba:Zelda Minish Cap']);
  // Games with saves first, most recently saved first.
  assert.deepEqual(await list('platform=gba&sort=saved'), ['gba:Metroid Fusion', 'gba:Advance Wars', 'gba:Zelda Minish Cap']);
  // Nintendo DS (1 game) after Game Boy Color (2) after Game Boy Advance (3).
  assert.deepEqual((await list('platformSort=games&sort=title-desc')).slice(2, 6), [
    'gba:Advance Wars',
    'gbc:Tetris DX',
    'gbc:Pokemon Crystal',
    'nds:Pokemon Platinum',
  ]);
  assert.equal((await srv.admin('GET', '/api/games?sort=random')).status, 400);
});

test('the device library lists every platform group with this device’s ROM state', async () => {
  const { status, body } = await thor.call('GET', '/api/device/library?platformSort=games');
  assert.equal(status, 200);
  assert.deepEqual(body.platforms, [
    { slug: 'gba', name: 'Game Boy Advance', games: 3 },
    { slug: 'gbc', name: 'Game Boy Color', games: 2 },
    { slug: 'nds', name: 'Nintendo DS', games: 1 },
  ]);
  assert.deepEqual(titles(body.games).slice(0, 3), ['gba:Advance Wars', 'gba:Metroid Fusion', 'gba:Zelda Minish Cap']);
  const metroid = body.games.find((g: { title: string }) => g.title === 'Metroid Fusion');
  assert.equal(metroid.saveCount, 1);
  assert.equal(metroid.roms[0].localPath, 'Metroid Fusion.gba');

  // Filters narrow the games but not the platform counts.
  const search = await thor.call('GET', '/api/device/library?q=pokemon&sort=title-desc');
  assert.deepEqual(titles(search.body.games), ['gbc:Pokemon Crystal', 'nds:Pokemon Platinum']);
  assert.equal(search.body.platforms.length, 3);
  const one = await thor.call('GET', '/api/device/library?platform=gbc');
  assert.deepEqual(titles(one.body.games), ['gbc:Pokemon Crystal', 'gbc:Tetris DX']);
});

test('devices can read game pages, saves and history, but not change them', async () => {
  const id = gameId('Metroid Fusion');
  const { status, body: game } = await thor.call('GET', `/api/games/${id}`);
  assert.equal(status, 200);
  assert.equal(game.title, 'Metroid Fusion');
  assert.equal(game.roms[0].localPath, 'Metroid Fusion.gba');
  assert.equal(game.roms[0].queued, false);
  assert.equal(game.roms[0].missing, false);
  assert.equal(game.saves.length, 1);
  assert.equal(game.saves[0].updatedBy, 'Thor');

  const versions = await thor.call('GET', `/api/saves/${game.saves[0].id}/versions`);
  assert.equal(versions.status, 200);
  assert.equal(versions.body.length, 1);
  assert.equal(versions.body[0].isCurrent, true);
  assert.equal(versions.body[0].device, 'Thor');

  assert.equal((await thor.call('GET', '/api/saves')).status, 200);
  assert.equal((await thor.call('GET', '/api/platforms')).status, 200);
  assert.equal((await thor.call('GET', '/api/games?platform=gba')).body.total, 3);

  // Management stays with the web GUI for now.
  assert.equal((await thor.call('PATCH', `/api/games/${id}`, { title: 'Nope' })).status, 401);
  assert.equal((await thor.call('POST', `/api/saves/${game.saves[0].id}/restore`, { versionId: versions.body[0].id })).status, 401);
  assert.equal((await thor.call('DELETE', `/api/saves/${game.saves[0].id}`)).status, 401);
  assert.equal((await thor.call('GET', '/api/devices')).status, 401);

  // The GUI's view has no device state on its ROMs.
  const admin = await srv.admin('GET', `/api/games/${id}`);
  assert.equal(admin.body.roms[0].queued, undefined);
});
