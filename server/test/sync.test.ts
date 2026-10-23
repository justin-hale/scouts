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

test('two emulators for one platform on one device sync as separate slots', async () => {
  // Azahar and Citra MMJ on the same handheld, each with its own sdmc folder.
  const handheld = await srv.pairDevice('Handheld');
  const put = await handheld.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: '3ds', profile: 'azahar', saveRoot: 'azahar-emu/sdmc' },
      { platform: '3ds', slot: '2', profile: 'azahar', saveRoot: 'citra-emu/sdmc' },
    ],
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const config = await handheld.call('GET', '/api/device/config');
  assert.deepEqual(
    config.body.mappings.map((m: any) => [m.platform, m.slot, m.saveRoot]),
    [
      ['3ds', '', 'azahar-emu/sdmc'],
      ['3ds', '2', 'citra-emu/sdmc'],
    ],
  );
  const dupe = await handheld.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: '3ds', slot: '2', profile: 'azahar' },
      { platform: '3ds', slot: '2', profile: 'azahar' },
    ],
  });
  assert.equal(dupe.status, 400);
  await handheld.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: '3ds', profile: 'azahar' },
      { platform: '3ds', slot: '2', profile: 'azahar' },
    ],
  });

  const rel = 'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/00040000/00055d00/data/00000001/main';
  const planSlot = async (slot: string, files: Record<string, Buffer>) => {
    const res = await handheld.call('POST', '/api/device/saves/plan', {
      platform: '3ds',
      slot,
      files: Object.entries(files).map(([p, data]) => ({ path: p, sha256: sha256(data), size: data.length })),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.actions as any[];
  };
  const ack = (slot: string, a: any) => handheld.call('POST', '/api/device/saves/ack', { slot, saveId: a.saveId, versionId: a.versionId });

  // Both folders start with the server's copy.
  const serverCopy = await handheld.download((await planSlot('', {}))[0].versionId);
  for (const slot of ['', '2']) {
    const [a] = await planSlot(slot, {});
    assert.equal(a.action, 'download');
    await ack(slot, a);
  }

  // Played in Citra MMJ (slot 2): it uploads, and Azahar's folder is told to
  // download, not flagged as a conflict, because slot '' never changed.
  const played = Buffer.from('progress made in citra mmj');
  let actions = await planSlot('2', { [rel]: played });
  assert.equal(actions[0].action, 'upload');
  const res = await srv.app.inject({
    method: 'PUT',
    url: `/api/device/saves/upload?platform=3ds&slot=2&path=${encodeURIComponent(rel)}&base=${actions[0].baseVersionId}`,
    headers: { ...handheld.headers, 'content-type': 'application/octet-stream' },
    payload: played,
  });
  assert.equal(res.json().status, 'ok');

  actions = await planSlot('', { [rel]: serverCopy });
  assert.equal(actions[0].action, 'download');
  assert.equal((await handheld.download(actions[0].versionId)).toString(), 'progress made in citra mmj');
  await ack('', actions[0]);
  assert.equal((await planSlot('', { [rel]: played }))[0].action, 'ok');
  assert.equal((await planSlot('2', { [rel]: played }))[0].action, 'ok');

  // A slot the device never mapped is rejected.
  const unknown = await handheld.call('POST', '/api/device/saves/plan', { platform: '3ds', slot: '9', files: [] });
  assert.equal(unknown.status, 400);
});

test('device sync never lets an empty save replace one with data', async () => {
  const handheld = await srv.pairDevice('Empty Tester');
  await handheld.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'gba', profile: 'mgba' }] });
  await handheld.call('POST', '/api/device/roms/inventory', { platform: 'gba', files: [{ path: ROM, size: romBytes.length }] });
  const blank = Buffer.alloc(32 * 1024, 0xff);

  // A fresh emulator made a blank save before the first sync: take the server's.
  let actions = await plan(handheld, 'gba', { 'Metroid Fusion (USA).sav': blank });
  assert.equal(actions[0].action, 'download');
  const real = await handheld.download(actions[0].versionId);
  await handheld.call('POST', '/api/device/saves/ack', { saveId: actions[0].saveId, versionId: actions[0].versionId });

  // Even after agreeing on the real save, a blank file is never uploaded.
  actions = await plan(handheld, 'gba', { 'Metroid Fusion (USA).sav': blank });
  assert.equal(actions[0].action, 'download');
  const up = await handheld.upload('gba', 'Metroid Fusion (USA).sav', blank, actions[0].versionId);
  assert.equal(up.status, 'empty');
  actions = await plan(handheld, 'gba', { 'Metroid Fusion (USA).sav': real });
  assert.equal(actions[0].action, 'ok', 'the real save is still current');

  // A blank save for a game the server has nothing for isn't uploaded either.
  await handheld.call('POST', '/api/device/roms/inventory', {
    platform: 'gba',
    files: [
      { path: ROM, size: romBytes.length },
      { path: 'Homebrew.gba', size: 10 },
    ],
  });
  actions = await plan(handheld, 'gba', { 'Homebrew.sav': Buffer.alloc(0) });
  assert.equal(actions[0].action, 'empty');
});

test('saves only belong to a ROM-keyed platform if the device has that ROM', async () => {
  // RetroArch keeps every platform's saves in one folder; this device reported
  // only Metroid Fusion for GBA, so a GBC game's save isn't a GBA save.
  const handheld = await srv.pairDevice('Shared Folder Tester');
  await handheld.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'gba', profile: 'retroarch' }] });
  await handheld.call('POST', '/api/device/roms/inventory', { platform: 'gba', files: [{ path: 'Metroid Fusion.gba', size: 1 }] });
  const actions = await plan(handheld, 'gba', {
    'Metroid Fusion.srm': Buffer.from('gba progress'),
    'Pokemon Crystal.srm': Buffer.from('gbc progress'),
  });
  assert.deepEqual(
    actions.map((a) => [a.path, a.action]),
    [
      ['Metroid Fusion.srm', 'conflict'],
      ['Pokemon Crystal.srm', 'unrecognized'],
    ],
  );
});

test('a save deleted in the GUI is not uploaded again by a device that still has it', async () => {
  const handheld = await srv.pairDevice('Tombstone Tester');
  await handheld.call('PUT', '/api/device/mappings', { mappings: [{ platform: 'ps2', profile: 'pcsx2' }] });
  const card = Buffer.alloc(4096, 5);
  card[0] = 1;
  assert.equal((await plan(handheld, 'ps2', { 'Mcd002.ps2': card }))[0].action, 'upload');
  const up = await handheld.upload('ps2', 'Mcd002.ps2', card, null);
  assert.equal(up.status, 'ok');

  const del = await srv.admin('DELETE', `/api/saves/${up.saveId}`);
  assert.equal(del.status, 200);

  assert.equal((await plan(handheld, 'ps2', { 'Mcd002.ps2': card }))[0].action, 'deleted');
  assert.equal((await handheld.upload('ps2', 'Mcd002.ps2', card, null)).status, 'deleted');
  const list = await srv.admin('GET', '/api/saves?platform=ps2');
  assert.ok(!list.body.some((s: any) => s.gameKey === 'Mcd002'), 'the deleted save stays deleted');

  // Played again since: that's new progress, so it syncs as a save again.
  const newer = Buffer.from(card);
  newer[1] = 2;
  assert.equal((await plan(handheld, 'ps2', { 'Mcd002.ps2': newer }))[0].action, 'upload');
  assert.equal((await handheld.upload('ps2', 'Mcd002.ps2', newer, null)).status, 'ok');
  assert.equal((await plan(handheld, 'ps2', { 'Mcd002.ps2': card }))[0].action !== 'deleted', true);
});

test('a conflict shows which emulator folder its copy came from and when each file changed', async () => {
  // Citra's folder is in sync; Azahar's folder on the same device holds an older copy.
  const handheld = await srv.pairDevice('Two Folders');
  await handheld.call('PUT', '/api/device/mappings', {
    mappings: [
      { platform: '3ds', profile: 'azahar', saveRoot: 'content://x/tree/primary%3Acitra-emu%2Fsdmc' },
      { platform: '3ds', slot: '2', profile: 'azahar', saveRoot: 'content://x/tree/primary%3ARoms%2F3ds%2Fsdmc' },
    ],
  });
  const rel = 'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/00040000/0011c400/data/00000001/main';
  const newer = Buffer.from('omega ruby, october');
  const older = Buffer.from('omega ruby, september');
  const put = (slot: string, data: Buffer, base: number | null, conflict: boolean, modified: number) =>
    srv.app.inject({
      method: 'PUT',
      url: `/api/device/saves/upload?platform=3ds&slot=${slot}&path=${encodeURIComponent(rel)}&base=${base ?? ''}&conflict=${conflict ? 1 : 0}&modified=${modified}`,
      headers: { ...handheld.headers, 'content-type': 'application/octet-stream' },
      payload: data,
    });
  const october = Date.UTC(2026, 9, 22, 15, 42);
  const september = Date.UTC(2026, 8, 23, 2, 20);
  assert.equal((await put('', newer, null, false, october)).json().status, 'ok');
  const res = await put('2', older, null, true, september);
  assert.equal(res.json().status, 'conflict');

  const conflicts = await srv.admin('GET', '/api/conflicts');
  const c = conflicts.body.find((x: any) => x.gameKey === '000400000011c400');
  assert.ok(c, JSON.stringify(conflicts.body));
  assert.equal(c.serverFileMtime, october);
  assert.equal(c.serverDevice, 'Two Folders');
  assert.equal(c.serverFolder, 'content://x/tree/primary%3Acitra-emu%2Fsdmc');
  assert.equal(c.deviceFileMtime, september);
  assert.equal(c.deviceFolder, 'content://x/tree/primary%3ARoms%2F3ds%2Fsdmc');
});

test('devices browse the library by game and get covers from the server cache', async () => {
  const handheld = await srv.pairDevice('Library Browser');
  const games = await handheld.call('GET', '/api/device/games?platform=gba');
  assert.equal(games.status, 200);
  const fusion = games.body.find((g: any) => g.title === 'Metroid Fusion');
  assert.ok(fusion, JSON.stringify(games.body));
  assert.deepEqual(
    fusion.roms.map((r: any) => [r.fileName, r.multiFile, r.localPath, r.queued]),
    [[ROM, false, null, false]],
  );

  // Covers were fetched with the server's metadata keys; devices just read the cached file.
  const coverDir = srv.services.ctx.coverDir;
  fs.mkdirSync(coverDir, { recursive: true });
  fs.writeFileSync(path.join(coverDir, 'test-cover.jpg'), 'jpeg bytes');
  const cover = await srv.app.inject({ method: 'GET', url: '/api/covers/test-cover.jpg', headers: handheld.headers });
  assert.equal(cover.statusCode, 200);
  assert.equal(cover.body, 'jpeg bytes');
  assert.equal((await srv.app.inject({ method: 'GET', url: '/api/covers/test-cover.jpg' })).statusCode, 401);
});
