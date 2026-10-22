import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDiscHeader, wiiTitleId } from '../src/library/disc.js';
import { cleanTitle } from '../src/library/names.js';
import { getPlatform } from '../src/platforms.js';
import { layoutProfile, loadProfiles, parseSavePath, renderSavePath, validateLayout } from '../src/profiles/profiles.js';
import { matchTemplate, renderTemplate } from '../src/profiles/template.js';
import { decodeSave } from '../src/saves/formats.js';

const profiles = loadProfiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'profiles'));
const profile = (id: string) => profiles.find((p) => p.id === id)!;
const gba = getPlatform('gba')!;
const n3ds = getPlatform('3ds')!;

test('templates match and render', () => {
  assert.deepEqual(matchTemplate('{game}.srm', 'Metroid (USA).srm'), { game: 'Metroid (USA)' });
  assert.equal(matchTemplate('{game}.srm', 'sub/Metroid.srm'), null);
  assert.deepEqual(matchTemplate('{a:4}{b:4}', '0004000a'), { a: '0004', b: '000a' });
  assert.deepEqual(matchTemplate('saves/{file**}', 'SAVES\\x\\y.bin'), { file: 'x/y.bin' });
  assert.equal(renderTemplate('{game}/{file**}', { game: 'A', file: 'b/c' }), 'A/b/c');
  assert.equal(renderTemplate('{game}.srm', { game: '../evil' }), null, 'no path escapes');
  assert.equal(renderTemplate('{game}/{file**}', { game: 'A', file: '../../etc/passwd' }), null);
});

test('RetroArch saves map to the canonical battery save', () => {
  const ra = profile('retroarch');
  assert.deepEqual(parseSavePath(ra, gba, 'Pokemon Emerald (USA).srm'), { gameKey: 'Pokemon Emerald (USA)', file: 'battery.sav' });
  assert.deepEqual(parseSavePath(ra, gba, 'Pokemon Emerald (USA).rtc'), { gameKey: 'Pokemon Emerald (USA)', file: 'rtc' });
  assert.equal(parseSavePath(ra, gba, 'Pokemon Emerald (USA).state'), null);
  assert.equal(renderSavePath(ra, gba, { gameKey: 'Zelda', file: 'battery.sav' }), 'Zelda.srm');
  assert.equal(renderSavePath(profile('mgba'), gba, { gameKey: 'Zelda', file: 'battery.sav' }), 'Zelda.sav');
  assert.equal(renderSavePath(profile('mgba'), gba, { gameKey: 'Zelda', file: 'rtc' }), null, 'mGBA has no rtc rule');
});

test('Azahar 3DS saves use the title ID and fill in console IDs', () => {
  const az = profile('azahar');
  const rel = 'Nintendo 3DS/abcdefabcdefabcdefabcdefabcdefab/0123456789abcdef0123456789abcdef/title/00040000/000A5E00/data/00000001/main';
  assert.deepEqual(parseSavePath(az, n3ds, rel), { gameKey: '00040000000a5e00', file: '00000001/main' });
  assert.equal(
    renderSavePath(az, n3ds, { gameKey: '00040000000a5e00', file: '00000001/main' }),
    'Nintendo 3DS/00000000000000000000000000000000/00000000000000000000000000000000/title/00040000/000a5e00/data/00000001/main',
  );
  // RetroArch's "*" rules only cover ROM-named platforms.
  assert.equal(parseSavePath(profile('retroarch'), n3ds, 'Game.srm'), null);
});

test('server layouts are validated and rendered', () => {
  assert.equal(validateLayout(gba, '{game}.sav'), 'Layout must contain {file} or {file**}');
  assert.equal(validateLayout(n3ds, 'title/{file**}'), 'Layout must contain {category}, {titleLow}');
  assert.equal(validateLayout(gba, '{game}/{file}'), null);
  const layout = layoutProfile(gba, gba.defaultSaveLayout);
  assert.equal(renderSavePath(layout, gba, { gameKey: 'Metroid (USA)', file: 'battery.sav' }), 'Metroid (USA)/battery.sav');
});

test('titles are cleaned from No-Intro names', () => {
  assert.equal(cleanTitle('Legend of Zelda, The - The Minish Cap (USA) [!].gba'), 'The Legend of Zelda - The Minish Cap');
  assert.equal(cleanTitle('Final Fantasy VII (USA) (Disc 1).cue'), 'Final Fantasy VII');
  assert.equal(cleanTitle('Metroid_Fusion.gba'), 'Metroid Fusion');
});

test('Dolphin GameCube cards and Wii NAND saves', () => {
  const dolphin = profile('dolphin');
  const gc = getPlatform('gc')!;
  const wii = getPlatform('wii')!;
  assert.deepEqual(parseSavePath(dolphin, gc, 'GC/MemoryCardA.USA.raw'), { gameKey: 'USA/A', file: 'card.raw' });
  assert.deepEqual(parseSavePath(dolphin, gc, 'GC/USA/Card A/01-GALE-SuperSmashBros0110290334.gci'), {
    gameKey: 'USA/A',
    file: '01-GALE-SuperSmashBros0110290334.gci',
  });
  assert.equal(renderSavePath(dolphin, gc, { gameKey: 'EUR/B', file: 'card.raw' }), 'GC/MemoryCardB.EUR.raw');
  assert.equal(renderSavePath(dolphin, gc, { gameKey: 'USA/A', file: 'x.gci' }), 'GC/USA/Card A/x.gci');
  assert.equal(
    renderSavePath(layoutProfile(gc, gc.defaultSaveLayout), gc, { gameKey: 'USA/A', file: 'card.raw' }),
    'USA/Card A/card.raw',
  );
  assert.deepEqual(parseSavePath(dolphin, wii, 'Wii/title/00010000/52534245/data/banner.bin'), {
    gameKey: '0001000052534245',
    file: 'banner.bin',
  });
});

test('memory card and DS wrapper profiles', () => {
  assert.deepEqual(parseSavePath(profile('pcsx2'), getPlatform('ps2')!, 'Mcd001.ps2'), { gameKey: 'Mcd001', file: 'card.ps2' });
  assert.deepEqual(parseSavePath(profile('flycast'), getPlatform('dreamcast')!, 'vmu_save_A1.bin'), { gameKey: 'A1', file: 'vmu.bin' });
  assert.deepEqual(parseSavePath(profile('duckstation'), getPlatform('psx')!, 'Final Fantasy VII (USA) (Disc 1)_1.mcd'), {
    gameKey: 'Final Fantasy VII (USA) (Disc 1)',
    file: 'battery.sav',
  });
  assert.deepEqual(parseSavePath(profile('drastic'), getPlatform('nds')!, 'Pokemon - Platinum Version (USA).dsv'), {
    gameKey: 'Pokemon - Platinum Version (USA)',
    file: 'battery.sav',
    format: 'desmume-dsv',
  });
});

test('GameCube and Wii disc IDs', () => {
  const header = (id: string, magicOffset: number, magic: number) => {
    const h = Buffer.alloc(0x80);
    h.write(id, 0, 'latin1');
    h.writeUInt32BE(magic, magicOffset);
    return h;
  };
  assert.deepEqual(parseDiscHeader(header('GALE01', 0x1c, 0xc2339f3d)), { system: 'gc', gameId: 'GALE01' });
  assert.deepEqual(parseDiscHeader(header('RSBE01', 0x18, 0x5d1c9ea3)), { system: 'wii', gameId: 'RSBE01' });
  assert.equal(parseDiscHeader(header('RSBE01', 0x18, 0x12345678)), null);
  assert.equal(wiiTitleId('RSBE01'), '0001000052534245');
});

test('DeSmuME footers are stripped', () => {
  const raw = Buffer.alloc(512, 7);
  const footer = Buffer.from('|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:\0\0\0\0|-DESMUME SAV-|');
  assert.deepEqual(decodeSave('desmume-dsv', Buffer.concat([raw, footer])), raw);
  assert.deepEqual(decodeSave('desmume-dsv', raw), raw);
});
