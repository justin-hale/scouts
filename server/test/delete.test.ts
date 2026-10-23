import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startServer, type TestServer } from './helpers.js';

let srv: TestServer;

before(async () => {
  srv = await startServer();
  write('roms/psx/Crash 2 (USA)/Crash 2 (USA).cue', 'FILE "Crash 2 (USA).bin" BINARY\n');
  write('roms/psx/Crash 2 (USA)/Crash 2 (USA).bin', 'disc');
  write('roms/psx/Crash 2 (USA)/mod/hd.zip', 'mod');
  write('roms/psx/Crash Bandicoot 2.bin', 'duplicate');
  write('roms/psx/Crash Bandicoot 2.srm', 'card with a save');
  write('roms/psx/Spyro.bin', 'spyro');
  write('roms/psx/Spyro.srm', 'spyro save');
  await srv.admin('PUT', '/api/platforms/psx', { romPath: file('roms/psx'), savePath: file('saves/psx') });
  await srv.services.scanner.run([srv.services.ctx.platform('psx')!]);
});

after(async () => {
  await srv.close();
});

const file = (rel: string) => path.join(srv.dir, rel);
const write = (rel: string, data: string) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), data);
};
const trashed = (rel: string) => {
  const trash = file('roms/psx/.romsafe-trash');
  return fs.existsSync(trash) && fs.readdirSync(trash).some((stamp) => fs.existsSync(path.join(trash, stamp, ...rel.split('/'))));
};

async function game(title: string) {
  const { body } = await srv.admin('GET', '/api/games?platform=psx');
  return body.items.find((g: { title: string }) => g.title === title) as { id: number } | undefined;
}

test('deleting the only ROM of a duplicate moves it to the trash and drops the game, but keeps its save', async () => {
  const dup = await game('Crash Bandicoot 2');
  assert.ok(dup);
  const { body: detail } = await srv.admin('GET', `/api/games/${dup.id}`);
  const res = await srv.admin('DELETE', `/api/roms/${detail.roms[0].id}`);
  assert.deepEqual(res.body, { gameDeleted: true });

  assert.equal(fs.existsSync(file('roms/psx/Crash Bandicoot 2.bin')), false);
  assert.ok(trashed('Crash Bandicoot 2.bin'));
  assert.equal(await game('Crash Bandicoot 2'), undefined);
  const { body: saves } = await srv.admin('GET', '/api/saves?platform=psx');
  const kept = saves.find((s: { gameKey: string }) => s.gameKey === 'Crash Bandicoot 2');
  assert.ok(kept, 'save survives');
  assert.equal(kept.gameId, null);

  // A rescan doesn't bring the trashed ROM back.
  await srv.services.scanner.run([srv.services.ctx.platform('psx')!]);
  assert.equal(await game('Crash Bandicoot 2'), undefined);
});

test('deleting a save removes its history, its file in the save folder, and unused blobs', async () => {
  const { body: saves } = await srv.admin('GET', '/api/saves?platform=psx');
  const save = saves.find((s: { gameKey: string }) => s.gameKey === 'Crash Bandicoot 2');
  const mirrored = file('saves/psx/Crash Bandicoot 2/battery.sav');
  assert.ok(fs.existsSync(mirrored));
  const blob = srv.services.sync.store.blobPath(save.sha256);

  assert.equal((await srv.admin('DELETE', `/api/saves/${save.id}`)).status, 200);
  assert.equal(fs.existsSync(mirrored), false);
  assert.equal(fs.existsSync(path.dirname(mirrored)), false, 'empty game folder removed');
  assert.equal(fs.existsSync(blob), false);
  assert.equal((await srv.admin('GET', `/api/saves/${save.id}/versions`)).body.length, 0);
  assert.equal((await srv.admin('DELETE', `/api/saves/${save.id}`)).status, 404);

  // The unchanged file next to the ROM isn't imported again on the next scan.
  await srv.services.scanner.run([srv.services.ctx.platform('psx')!]);
  const { body: after } = await srv.admin('GET', '/api/saves?platform=psx');
  assert.equal(after.some((s: { gameKey: string }) => s.gameKey === 'Crash Bandicoot 2'), false);
});

test('deleting a game trashes its sheet, tracks and extras, and its saves when asked', async () => {
  const crash = await game('Crash 2');
  assert.ok(crash);
  const res = await srv.admin('DELETE', `/api/games/${crash.id}`);
  assert.deepEqual(res.body, { roms: 1, extras: 1, saves: 0 });
  assert.equal(fs.existsSync(file('roms/psx/Crash 2 (USA)')), false, 'emptied game folder removed');
  assert.ok(trashed('Crash 2 (USA)/Crash 2 (USA).cue'));
  assert.ok(trashed('Crash 2 (USA)/Crash 2 (USA).bin'));
  assert.ok(trashed('Crash 2 (USA)/mod/hd.zip'));

  const spyro = await game('Spyro');
  assert.ok(spyro);
  const withSaves = await srv.admin('DELETE', `/api/games/${spyro.id}?saves=1`);
  assert.deepEqual(withSaves.body, { roms: 1, extras: 0, saves: 1 });
  const { body: saves } = await srv.admin('GET', '/api/saves?platform=psx');
  assert.equal(saves.length, 0);
});
