import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { unzipBuffer } from '../src/library/zip.js';
import { startServer, type TestServer } from './helpers.js';

let srv: TestServer;

const file = (rel: string) => path.join(srv.dir, rel);
const write = (rel: string, data: string | Buffer) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), data);
};

before(async () => {
  srv = await startServer();
  // A Redump-style multi-track disc: one sheet, one .bin per track (the sheet's case differs from the disk's).
  write('roms/psx/Multi (USA)/Multi (USA).cue', 'FILE "multi (usa) (track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Multi (USA) (Track 2).bin" BINARY\n  TRACK 02 AUDIO\n');
  write('roms/psx/Multi (USA)/Multi (USA) (Track 1).bin', Buffer.alloc(3000, 1));
  write('roms/psx/Multi (USA)/Multi (USA) (Track 2).bin', Buffer.alloc(2000, 2));
  // CloneCD: the .img is the ROM; .ccd and .sub belong with it.
  write('roms/psx/Clone/Clone.img', 'image');
  write('roms/psx/Clone/Clone.ccd', 'ccd');
  write('roms/psx/Clone/Clone.sub', 'sub');
  // A two-disc game behind a playlist.
  write('roms/psx/Two/Two.m3u', '# playlist\nTwo (Disc 1).cue\nTwo (Disc 2).cue\n');
  write('roms/psx/Two/Two (Disc 1).cue', 'FILE "Two (Disc 1).bin" BINARY\n');
  write('roms/psx/Two/Two (Disc 1).bin', 'disc one');
  write('roms/psx/Two/Two (Disc 2).cue', 'FILE "Two (Disc 2).bin" BINARY\n');
  write('roms/psx/Two/Two (Disc 2).bin', 'disc two');
  write('roms/psx/Loose.bin', 'loose');
  write('roms/psx/Loose.srm', 'a save');
  await srv.admin('PUT', '/api/platforms/psx', { romPath: file('roms/psx'), savePath: file('saves/psx') });
  await srv.services.scanner.run([srv.services.ctx.platform('psx')!]);
});

after(async () => {
  await srv.close();
});

async function romOf(title: string, fileName: string) {
  const { body: list } = await srv.admin('GET', '/api/games?platform=psx');
  const g = list.items.find((x: { title: string }) => x.title === title);
  assert.ok(g, `no game ${title}`);
  const { body } = await srv.admin('GET', `/api/games/${g.id}`);
  const rom = body.roms.find((r: { fileName: string }) => r.fileName === fileName);
  assert.ok(rom, `no ROM ${fileName}`);
  return rom;
}

async function download(romId: number) {
  const res = await srv.app.inject({ method: 'GET', url: `/api/roms/${romId}/download`, headers: { cookie: srv.cookie } });
  assert.equal(res.statusCode, 200);
  return res;
}

test('a .cue keeps its tracks as parts and downloads as one zip', async () => {
  const rom = await romOf('Multi', 'Multi (USA).cue');
  assert.deepEqual(
    rom.parts.map((p: { path: string; size: number }) => [p.path, p.size]),
    [
      ['Multi (USA)/Multi (USA) (Track 1).bin', 3000],
      ['Multi (USA)/Multi (USA) (Track 2).bin', 2000],
    ],
  );
  assert.equal(rom.totalSize, rom.size + 5000);
  assert.equal(rom.serverPath, file('roms/psx/Multi (USA)/Multi (USA).cue'));

  const res = await download(rom.id);
  assert.match(String(res.headers['content-disposition']), /Multi%20\(USA\)\.zip/);
  const entries = unzipBuffer(res.rawPayload); // also checks every CRC
  assert.deepEqual(
    entries.map((e) => e.name),
    ['Multi (USA).cue', 'Multi (USA) (Track 1).bin', 'Multi (USA) (Track 2).bin'],
  );
  assert.deepEqual(entries[2]!.data, Buffer.alloc(2000, 2));
});

test('a CloneCD .img brings its .ccd and .sub', async () => {
  const rom = await romOf('Clone', 'Clone.img');
  assert.deepEqual(rom.parts.map((p: { path: string }) => p.path).sort(), ['Clone/Clone.ccd', 'Clone/Clone.sub']);
  assert.deepEqual(unzipBuffer((await download(rom.id)).rawPayload).map((e) => e.name), ['Clone.img', 'Clone.ccd', 'Clone.sub']);
});

test('an .m3u downloads with every disc and its tracks', async () => {
  const rom = await romOf('Two', 'Two.m3u');
  const names = unzipBuffer((await download(rom.id)).rawPayload).map((e) => e.name);
  assert.deepEqual(names, ['Two.m3u', 'Two (Disc 1).cue', 'Two (Disc 1).bin', 'Two (Disc 2).cue', 'Two (Disc 2).bin']);
});

test('a single-file ROM still downloads as itself', async () => {
  const rom = await romOf('Loose', 'Loose.bin');
  assert.deepEqual(rom.parts, []);
  const res = await download(rom.id);
  assert.equal(res.body, 'loose');
});

test('a changed track is re-checked, so the zip never carries a stale CRC', async () => {
  const rom = await romOf('Multi', 'Multi (USA).cue');
  write('roms/psx/Multi (USA)/Multi (USA) (Track 2).bin', Buffer.alloc(2000, 9)); // same size, new content, no rescan
  const entries = unzipBuffer((await download(rom.id)).rawPayload);
  assert.deepEqual(entries[2]!.data, Buffer.alloc(2000, 9));
});

test('saves report where their copy lives in the save folder', async () => {
  const { body } = await srv.admin('GET', '/api/saves?platform=psx');
  assert.equal(body[0].serverPath, file('saves/psx/Loose/battery.sav'));
});
