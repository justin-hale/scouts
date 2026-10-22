import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanTitle } from '../src/library/names.js';
import { getPlatform } from '../src/platforms.js';
import { layoutProfile, loadProfiles, parseSavePath, renderSavePath, validateLayout } from '../src/profiles/profiles.js';
import { matchTemplate, renderTemplate } from '../src/profiles/template.js';

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
