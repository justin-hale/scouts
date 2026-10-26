import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { cleanTitle } from '../src/library/names.js';
import { cueFiles, gdiFiles } from '../src/library/sheets.js';
import { readZipEntryHead } from '../src/library/zip.js';
import { gciComment } from '../src/saves/labels.js';
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
// node:sqlite rows have a null prototype; copy them so deepEqual compares values only.
const rows = <T extends object>(sql: string, params: Record<string, string | number> = {}) =>
  srv.services.ctx.db.all<T>(sql, params).map((r) => ({ ...r }));

async function scan(slug: string) {
  await srv.admin('PUT', `/api/platforms/${slug}`, { romPath: file(`roms/${slug}`), savePath: file(`saves/${slug}`) });
  await srv.services.scanner.run([srv.services.ctx.platform(slug)!]);
  assert.deepEqual(srv.services.scanner.status.errors, []);
}

const zip = (name: string, data: Buffer) => makeZip({ [name]: data });

test('titles drop untagged disc numbers', () => {
  assert.equal(cleanTitle('Final Fantasy 9 cd1.iso'), 'Final Fantasy 9');
  assert.equal(cleanTitle('Grandia (USA) (Disc 2).cue'), 'Grandia');
  assert.equal(cleanTitle('Discworld.bin'), 'Discworld');
});

test('cue and gdi sheets list their track files', () => {
  assert.deepEqual(cueFiles('FILE "Game (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE track2.bin BINARY\n'), [
    'Game (Track 1).bin',
    'track2.bin',
  ]);
  assert.deepEqual(gdiFiles('2\n1 0 4 2352 track01.bin 0\n2 600 0 2352 "track 02.raw" 0\n'), ['track01.bin', 'track 02.raw']);
});

test('zip headers are read without extracting', async () => {
  write('zips/game.zip', zip('Game.3ds', ncsd(0x0004000000055e00n)));
  const entry = await readZipEntryHead(file('zips/game.zip'), new Set(['.3ds']), 0x200);
  assert.equal(entry?.name, 'Game.3ds');
  assert.equal(entry?.head.toString('ascii', 0x100, 0x104), 'NCSD');
});

test('PlayStation: bare images, sheet tracks, multi-disc games, extras and saves beside ROMs', async () => {
  write('roms/psx/Game A (USA)/Game A (USA).cue', 'FILE "Game A (USA).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  write('roms/psx/Game A (USA)/Game A (USA).bin', 'disc a');
  write('roms/psx/Game A (USA)/mod/textures.zip', 'pack');
  write('roms/psx/Loose.bin', 'loose disc');
  write('roms/psx/Loose.srm', 'memory card 1');
  write('roms/psx/Orphan.srm', 'no rom for me');
  write('roms/psx/FF9/Final Fantasy 9 cd1.iso', 'disc 1');
  write('roms/psx/FF9/Final Fantasy 9 cd2.iso', 'disc 2');
  write('roms/psx/firmware/scph1001.bin', 'bios');
  await scan('psx');

  const roms = rows<{ rel_path: string }>("SELECT rel_path FROM roms WHERE platform = 'psx' ORDER BY rel_path").map((r) => r.rel_path);
  assert.deepEqual(roms, ['FF9/Final Fantasy 9 cd1.iso', 'FF9/Final Fantasy 9 cd2.iso', 'Game A (USA)/Game A (USA).cue', 'Loose.bin']);
  const games = rows<{ title: string }>("SELECT title FROM games WHERE platform = 'psx' ORDER BY title").map((g) => g.title);
  assert.deepEqual(games, ['Final Fantasy 9', 'Game A', 'Loose']);

  const extras = rows<{ kind: string; title: string | null }>(
    "SELECT e.kind, g.title FROM extras e LEFT JOIN games g ON g.id = e.game_id WHERE e.platform = 'psx' ORDER BY e.kind",
  );
  assert.deepEqual(extras, [
    { kind: 'firmware', title: null },
    { kind: 'mod', title: 'Game A' },
  ]);

  const saves = rows<{ game_key: string; file: string }>("SELECT game_key, file FROM saves WHERE platform = 'psx'");
  assert.deepEqual(saves, [{ game_key: 'Loose', file: 'battery.sav' }]);
  assert.equal(fs.readFileSync(file('saves/psx/Loose/battery.sav'), 'utf8'), 'memory card 1');

  // An unchanged file beside the ROM is not imported again, even once the server holds a newer version.
  const save = srv.services.sync.store.findSave('psx', { gameKey: 'Loose', file: 'battery.sav' })!;
  srv.services.sync.store.addVersion(save, Buffer.from('newer from a device'), { makeCurrent: true });
  await scan('psx');
  assert.equal(fs.readFileSync(file('saves/psx/Loose/battery.sav'), 'utf8'), 'newer from a device');

  // Playing next to the ROM again does make a new version.
  write('roms/psx/Loose.srm', 'played locally');
  await scan('psx');
  assert.equal(fs.readFileSync(file('saves/psx/Loose/battery.sav'), 'utf8'), 'played locally');
});

test('Game Boy games in the GBC folder are indexed', async () => {
  write('roms/gbc/Tetris.gb', 'tetris');
  write('roms/gbc/Pokemon Crystal.gbc', 'crystal');
  await scan('gbc');
  assert.equal(rows("SELECT id FROM roms WHERE platform = 'gbc'").length, 2);
});

test('the game list is sorted by platform name, then title', async () => {
  const { body } = await srv.admin('GET', '/api/games');
  const order = body.items.map((g: { platform: string; title: string }) => `${g.platform}:${g.title}`);
  // Game Boy Color comes before PlayStation alphabetically; titles are A-Z within each.
  assert.deepEqual(order, ['gbc:Pokemon Crystal', 'gbc:Tetris', 'psx:Final Fantasy 9', 'psx:Game A', 'psx:Loose']);
});

test('zipped 3DS and GameCube ROMs get title IDs, and GCI saves link to their game', async () => {
  write('roms/3ds/Some Game (USA).zip', zip('Some Game (USA).3ds', ncsd(0x000400000008d300n)));
  await scan('3ds');
  assert.deepEqual(rows("SELECT title_id FROM roms WHERE platform = '3ds'"), [{ title_id: '000400000008d300' }]);

  write('roms/gc/Wind Waker (USA).zip', zip('Wind Waker (USA).iso', gcDisc('GZLE01')));
  write('saves/gc/USA/Card A/01-GZLE-gczelda.gci', gci('GZLE', '01', 'Zelda: The Wind Waker', 'File 1'));
  write('saves/gc/USA/Card A/8P-GM2E-super_monkey_ball_2.dat.gci', gci('GM2E', '8P', 'Super Monkey Ball 2', 'Game data'));
  await scan('gc');

  const linked = rows<{ file: string; title: string | null }>(
    "SELECT s.file, g.title FROM saves s LEFT JOIN games g ON g.id = s.game_id WHERE s.platform = 'gc' ORDER BY s.file",
  );
  assert.deepEqual(linked, [
    { file: '01-GZLE-gczelda.gci', title: 'Wind Waker' },
    { file: '8P-GM2E-super_monkey_ball_2.dat.gci', title: null },
  ]);

  const { body } = await srv.admin('GET', '/api/saves?platform=gc');
  const monkey = body.find((s: { file: string }) => s.file.startsWith('8P-GM2E'));
  assert.equal(monkey.label, 'Super Monkey Ball 2 · Game data');
  assert.equal(gciComment(gci('GZLE', '01', 'Zelda', 'Zelda')), 'Zelda');
});
