import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { unzipBuffer } from '../src/library/zip.js';
import { isEmptySave } from '../src/saves/content.js';
import { gcDisc, gci, makeZip, ncsd, startServer, type TestServer } from './helpers.js';

let srv: TestServer;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv.close();
});

const file = (rel: string) => path.join(srv.dir, rel);
const write = (rel: string, data: Buffer | string) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), data);
};

async function put(url: string, body: Buffer | string) {
  const res = await srv.app.inject({
    method: 'PUT',
    url,
    payload: Buffer.from(body),
    headers: { cookie: srv.cookie, 'content-type': 'application/octet-stream' },
  });
  return { status: res.statusCode, body: res.json() };
}

async function idle() {
  while (srv.services.scanner.status.running) await new Promise((r) => setTimeout(r, 10));
}

async function setup(slug: string) {
  await srv.admin('PUT', `/api/platforms/${slug}`, { romPath: file(`roms/${slug}`), savePath: file(`saves/${slug}`) });
}

async function gameId(platform: string, title: string): Promise<number> {
  const { body } = await srv.admin('GET', `/api/games?platform=${platform}`);
  const g = body.items.find((x: { title: string }) => x.title === title);
  assert.ok(g, `no game "${title}"`);
  return g.id;
}

test('ROM uploads land in the ROM folder and get scanned', async () => {
  await setup('gba');
  const ok = await put('/api/roms/upload?platform=gba&path=Metroid%20Fusion%20(USA).gba', 'metroid');
  assert.equal(ok.status, 200);
  assert.equal(fs.readFileSync(file('roms/gba/Metroid Fusion (USA).gba'), 'utf8'), 'metroid');
  await idle();
  await gameId('gba', 'Metroid Fusion');

  assert.equal((await put('/api/roms/upload?platform=gba&path=Metroid%20Fusion%20(USA).gba', 'again')).status, 409);
  assert.equal((await put('/api/roms/upload?platform=gba&path=..%2Fescape.gba', 'x')).status, 400);
  assert.equal((await put('/api/roms/upload?platform=gba&path=notes.txt', 'x')).status, 400);
  // Anything goes in a side folder.
  assert.equal((await put('/api/roms/upload?platform=gba&path=Metroid%20Fusion%2Fpatch%2Fhard.ips', 'ips')).status, 200);
  const anon = await srv.app.inject({
    method: 'PUT',
    url: '/api/roms/upload?platform=gba&path=x.gba',
    payload: 'x',
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(anon.statusCode, 401);
});

test('a DS save uploaded under any name is keyed by the ROM and loses its DeSmuME footer', async () => {
  write('roms/nds/Pokemon - Black Version 2.nds', 'rom');
  await setup('nds');
  await srv.services.scanner.run([srv.services.ctx.platform('nds')!]);
  const id = await gameId('nds', 'Pokemon - Black Version 2');

  const raw = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 251));
  const dsv = Buffer.concat([raw, Buffer.from('|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:')]);
  const res = await put(`/api/games/${id}/saves/upload?name=${encodeURIComponent('Pokemon - Black Version 2 [2026-10-22_14-07-29].srm')}`, dsv);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changed, [{ gameKey: 'Pokemon - Black Version 2', file: 'battery.sav' }]);
  assert.deepEqual(fs.readFileSync(file('saves/nds/Pokemon - Black Version 2/battery.sav')), raw);

  const bad = await put(`/api/games/${id}/saves/upload?name=notes.txt`, 'x');
  assert.equal(bad.status, 400);

  // A blank save (the game never wrote to it) is kept in history but never replaces real data.
  const blank = await put(`/api/games/${id}/saves/upload?name=blank.sav`, Buffer.alloc(512, 0xff));
  assert.equal(blank.status, 400);
  assert.deepEqual(fs.readFileSync(file('saves/nds/Pokemon - Black Version 2/battery.sav')), raw);
  const { body: game } = await srv.admin('GET', `/api/games/${id}`);
  assert.equal(game.saves[0].versionCount, 2);
  assert.equal(game.saves[0].empty, false);
  assert.equal(game.saves[0].downloadName, 'Pokemon - Black Version 2.sav');
});

test('empty saves are recognised', () => {
  assert.equal(isEmptySave('gba', Buffer.alloc(1024, 0xff)), true);
  assert.equal(isEmptySave('gba', Buffer.from([0xff, 0x01, 0xff])), false);
  const card = Buffer.alloc(128 * 1024);
  card.write('MC', 0, 'latin1');
  for (let i = 1; i <= 15; i++) card[i * 0x80] = 0xa0;
  assert.equal(isEmptySave('psx', card), true);
  card[3 * 0x80] = 0x51; // one block in use
  assert.equal(isEmptySave('psx', card), false);
});

test('3DS saves upload as a zip of the save folder', async () => {
  write('roms/3ds/Pokemon Y.3ds', ncsd(0x0004000000055e00n));
  await setup('3ds');
  await srv.services.scanner.run([srv.services.ctx.platform('3ds')!]);
  const id = await gameId('3ds', 'Pokemon Y');

  const zip = makeZip({ 'data/00000001/main': 'pokemon y', 'data/00000001.metadata': 'meta' });
  const res = await put(`/api/games/${id}/saves/upload?name=autosave.zip`, zip);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changed.map((k: { file: string }) => k.file).sort(), ['00000001.metadata', '00000001/main']);
  const main = 'saves/3ds/Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/00040000/00055e00/data/00000001/main';
  assert.equal(fs.readFileSync(file(main), 'utf8'), 'pokemon y');

  assert.equal((await put(`/api/games/${id}/saves/upload?name=main`, 'x')).status, 400);
  assert.equal((await put(`/api/games/${id}/saves/upload?name=broken.zip`, 'not a zip')).status, 400);
});

test('GameCube GCI uploads go on card A of their region', async () => {
  write('roms/gc/Wind Waker.iso', gcDisc('GZLE01'));
  await setup('gc');
  await srv.services.scanner.run([srv.services.ctx.platform('gc')!]);
  const id = await gameId('gc', 'Wind Waker');

  const res = await put(`/api/games/${id}/saves/upload?name=download.gci`, gci('GZLE', '01', 'Zelda', 'File 1', 'gczelda'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changed, [{ gameKey: 'USA/A', file: '01-GZLE-gczelda.gci' }]);
  assert.ok(fs.existsSync(file('saves/gc/USA/Card A/01-GZLE-gczelda.gci')));
  const { body } = await srv.admin('GET', `/api/games/${id}`);
  assert.equal(body.saves.length, 1);
});

test('saves export as a zip, in the server layout or an emulator profile', async () => {
  const names = async (qs: string) => {
    const res = await srv.app.inject({ method: 'GET', url: `/api/saves/export.zip${qs}`, headers: { cookie: srv.cookie } });
    assert.equal(res.statusCode, 200);
    return unzipBuffer(res.rawPayload).map((e) => e.name).sort();
  };
  const all = await names('');
  assert.ok(all.includes('nds/Pokemon - Black Version 2/battery.sav'));
  assert.ok(all.includes('gc/USA/Card A/01-GZLE-gczelda.gci'));

  const retro = await names('?profile=retroarch');
  assert.ok(retro.includes('nds/Pokemon - Black Version 2.srm'));
  // RetroArch has no 3DS layout, so those keep the server's.
  assert.ok(retro.some((n) => n.startsWith('3ds/Nintendo 3DS/') && n.endsWith('/00000001/main')));

  const id = await gameId('nds', 'Pokemon - Black Version 2');
  assert.deepEqual(await names(`?gameId=${id}&profile=generic-sav`), ['Pokemon - Black Version 2.sav']);
  assert.deepEqual(await names('?platform=gc'), ['gc/USA/Card A/01-GZLE-gczelda.gci']);
});

test('covers can be uploaded, and picked only from known image hosts', async () => {
  const id = await gameId('gc', 'Wind Waker');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.equal((await put(`/api/games/${id}/cover/upload`, png)).status, 200);
  const { body } = await srv.admin('GET', `/api/games/${id}`);
  assert.match(body.cover, /^\d+-[0-9a-f]{12}\.png$/);

  assert.equal((await put(`/api/games/${id}/cover/upload`, 'not an image')).status, 400);
  const evil = await srv.admin('POST', `/api/games/${id}/cover`, { url: 'http://192.168.1.1/admin' });
  assert.equal(evil.status, 400);
});
