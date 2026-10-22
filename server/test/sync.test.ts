import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { sha256, startServer, type TestDevice, type TestServer } from './helpers.js';

let srv: TestServer;
let phone: TestDevice;
let pc: TestDevice;
const ROM = 'Metroid Fusion (USA).gba';
const romBytes = Buffer.from('fake gba rom contents');

const plan = async (dev: TestDevice, platform: string, files: Record<string, Buffer>) => {
  const res = await dev.call('POST', '/api/device/saves/plan', {
    platform,
    files: Object.entries(files).map(([p, data]) => ({ path: p, sha256: sha256(data), size: data.length })),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.actions as any[];
};

before(async () => {
  srv = await startServer();
  const romDir = path.join(srv.dir, 'roms', 'gba');
  fs.mkdirSync(romDir, { recursive: true });
  fs.writeFileSync(path.join(romDir, ROM), romBytes);
  const put = await srv.admin('PUT', '/api/platforms/gba', { romPath: romDir, savePath: path.join(srv.dir, 'saves', 'gba') });
  assert.equal(put.status, 200);
  await srv.services.scanner.run([srv.services.ctx.platform('gba')!]);

  phone = await srv.pairDevice('Phone');
  pc = await srv.pairDevice('PC');
  // Phone runs RetroArch and named its ROM differently; PC runs mGBA.
  assert.equal((await phone.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'gba', profile: 'retroarch' }] })).status, 200);
  assert.equal((await pc.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'gba', profile: 'mgba' }] })).status, 200);
});

after(() => srv.close());

test('scan finds the ROM and creates a game', async () => {
  const { body } = await srv.admin('GET', '/api/games?platform=gba');
  assert.equal(body.total, 1);
  assert.equal(body.items[0].title, 'Metroid Fusion');
});

test('device ROMs are matched by hash and missing ROMs can be queued', async () => {
  const inv = await phone.call('POST', '/api/device/roms/inventory', {
    platform: 'gba',
    files: [{ path: 'Metroid Fusion.gba', size: romBytes.length, sha1: crypto.createHash('sha1').update(romBytes).digest('hex') }],
  });
  assert.equal(inv.body.results[0].match, 'hash');

  const roms = await pc.call('GET', '/api/device/roms?platform=gba');
  assert.equal(roms.body[0].localPath, null);
  await pc.call('POST', '/api/device/roms/queue', { romIds: [roms.body[0].id] });
  const queue = await pc.call('GET', '/api/device/roms/queue');
  assert.equal(queue.body.length, 1);
  const dl = await srv.app.inject({ method: 'GET', url: queue.body[0].url, headers: { ...pc.headers, range: 'bytes=0-3' } });
  assert.equal(dl.statusCode, 206);
  assert.equal(dl.body, 'fake');
  // Reporting the downloaded file clears it from the queue.
  await pc.call('POST', '/api/device/roms/inventory', { platform: 'gba', files: [{ path: ROM, size: romBytes.length }] });
  assert.equal((await pc.call('GET', '/api/device/roms/queue')).body.length, 0);
});

test('a save flows from RetroArch on the phone to mGBA on the PC', async () => {
  const v1 = Buffer.from('save v1');
  let actions = await plan(phone, 'gba', { 'Metroid Fusion.srm': v1, 'notes.txt': Buffer.from('x') });
  assert.deepEqual(
    actions.map((a) => [a.path, a.action]),
    [
      ['Metroid Fusion.srm', 'upload'],
      ['notes.txt', 'unrecognized'],
    ],
  );
  const up = await phone.upload('gba', 'Metroid Fusion.srm', v1, null);
  assert.equal(up.status, 'ok');

  // Mirrored into the server save folder under the server ROM name.
  const mirrored = path.join(srv.dir, 'saves', 'gba', 'Metroid Fusion (USA)', 'battery.sav');
  assert.equal(fs.readFileSync(mirrored, 'utf8'), 'save v1');

  // The PC has nothing yet: it is told to download, named for mGBA and its own ROM.
  actions = await plan(pc, 'gba', {});
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'download');
  assert.equal(actions[0].path, 'Metroid Fusion (USA).sav');
  assert.equal((await pc.download(actions[0].versionId)).toString(), 'save v1');
  await pc.call('POST', '/api/device/saves/ack', { saveId: actions[0].saveId, versionId: actions[0].versionId });

  assert.equal((await plan(pc, 'gba', { 'Metroid Fusion (USA).sav': v1 }))[0].action, 'ok');

  // PC plays and saves; phone is unchanged, so it downloads.
  const v2 = Buffer.from('save v2 from pc');
  actions = await plan(pc, 'gba', { 'Metroid Fusion (USA).sav': v2 });
  assert.equal(actions[0].action, 'upload');
  assert.equal((await pc.upload('gba', 'Metroid Fusion (USA).sav', v2, actions[0].baseVersionId)).status, 'ok');

  actions = await plan(phone, 'gba', { 'Metroid Fusion.srm': v1 });
  assert.equal(actions[0].action, 'download');
  assert.equal((await phone.download(actions[0].versionId)).toString(), 'save v2 from pc');
  await phone.call('POST', '/api/device/saves/ack', { saveId: actions[0].saveId, versionId: actions[0].versionId });
});

test('both sides changing produces a conflict that the user resolves', async () => {
  const phoneSave = Buffer.from('phone progress');
  const pcSave = Buffer.from('pc progress');

  let actions = await plan(pc, 'gba', { 'Metroid Fusion (USA).sav': pcSave });
  await pc.upload('gba', 'Metroid Fusion (USA).sav', pcSave, actions[0].baseVersionId);

  actions = await plan(phone, 'gba', { 'Metroid Fusion.srm': phoneSave });
  assert.equal(actions[0].action, 'conflict');
  const up = await phone.upload('gba', 'Metroid Fusion.srm', phoneSave, actions[0].baseVersionId, true);
  assert.equal(up.status, 'conflict');

  // Nothing is overwritten while the conflict is open.
  assert.equal((await plan(phone, 'gba', { 'Metroid Fusion.srm': phoneSave }))[0].action, 'pending-conflict');

  const conflicts = await srv.admin('GET', '/api/conflicts');
  assert.equal(conflicts.body.length, 1);
  assert.equal(conflicts.body[0].device, 'Phone');
  await srv.admin('POST', `/api/conflicts/${conflicts.body[0].id}/resolve`, { keep: 'device' });

  assert.equal((await plan(phone, 'gba', { 'Metroid Fusion.srm': phoneSave }))[0].action, 'ok');
  actions = await plan(pc, 'gba', { 'Metroid Fusion (USA).sav': pcSave });
  assert.equal(actions[0].action, 'download');
  assert.equal((await pc.download(actions[0].versionId)).toString(), 'phone progress');

  const game = await srv.admin('GET', '/api/games?platform=gba');
  const detail = await srv.admin('GET', `/api/games/${game.body.items[0].id}`);
  const versions = await srv.admin('GET', `/api/saves/${detail.body.saves[0].id}/versions`);
  assert.equal(versions.body.length, 4, 'every version is kept');
});

test('saves already in the server folder are imported on scan', async () => {
  const saveRoot = path.join(srv.dir, 'saves', '3ds');
  await srv.admin('PUT', '/api/platforms/3ds', { savePath: saveRoot });
  const rel = 'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/00040000/00055d00/data/00000001/main';
  fs.mkdirSync(path.dirname(path.join(saveRoot, rel)), { recursive: true });
  fs.writeFileSync(path.join(saveRoot, rel), 'pokemon x');
  await srv.services.scanner.run([srv.services.ctx.platform('3ds')!]);

  await phone.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: 'gba', profile: 'retroarch' },
      { platform: '3ds', profile: 'azahar' },
    ],
  });
  const actions = await plan(phone, '3ds', {});
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'download');
  assert.equal(actions[0].path, rel);
});

test('device endpoints reject unknown tokens and unsafe paths', async () => {
  const bad = await srv.app.inject({ method: 'GET', url: '/api/device/config', headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.statusCode, 401);
  const res = await phone.call('POST', '/api/device/saves/plan', {
    platform: 'gba',
    files: [{ path: '../../etc/passwd', sha256: sha256('x'), size: 1 }],
  });
  assert.equal(res.status, 400);
  const noAdmin = await srv.app.inject({ method: 'GET', url: '/api/devices' });
  assert.equal(noAdmin.statusCode, 401);
});

test('DraStic .dsv saves are stored raw and shared with melonDS', async () => {
  const thor = await srv.pairDevice('AYN Thor');
  await thor.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'nds', profile: 'drastic' }] });
  await pc.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: 'gba', profile: 'mgba' },
      { platform: 'nds', profile: 'melonds' },
    ],
  });
  const raw = Buffer.alloc(1024, 3);
  const footer = Buffer.from('|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:\0\0\0\0|-DESMUME SAV-|');
  const dsv = Buffer.concat([raw, footer]);

  let actions = await plan(thor, 'nds', { 'Pokemon Platinum.dsv': dsv });
  assert.equal(actions[0].action, 'upload');
  await thor.upload('nds', 'Pokemon Platinum.dsv', dsv, null);

  // The Thor's file (with footer) is in sync even though the server stores it raw.
  assert.equal((await plan(thor, 'nds', { 'Pokemon Platinum.dsv': dsv }))[0].action, 'ok');

  actions = await plan(pc, 'nds', {});
  assert.equal(actions[0].path, 'Pokemon Platinum.sav');
  assert.deepEqual(await pc.download(actions[0].versionId), raw);
});

test('PS2 memory cards sync as whole cards', async () => {
  const card = Buffer.alloc(2048, 9);
  await phone.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'ps2', profile: 'pcsx2' }] });
  await pc.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'ps2', profile: 'pcsx2' }] });
  assert.equal((await plan(phone, 'ps2', { 'Mcd001.ps2': card }))[0].action, 'upload');
  await phone.upload('ps2', 'Mcd001.ps2', card, null);
  const actions = await plan(pc, 'ps2', {});
  assert.deepEqual(
    actions.map((a) => [a.action, a.path]),
    [['download', 'Mcd001.ps2']],
  );
  const list = await srv.admin('GET', '/api/saves?platform=ps2');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].gameId, null);
  assert.equal(list.body[0].gameKey, 'Mcd001');
});
