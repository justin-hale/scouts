import fs from 'node:fs';
import path from 'node:path';

/**
 * Track files that a .cue or .gdi sheet points at. The sheet is the game;
 * its tracks (Magical Drop has 13 .bin files) are not separate ROMs. A .bin
 * or .img with no sheet next to it is still indexed on its own.
 * Returns lower-cased relative paths, since sheets often disagree with the
 * file system on case.
 */
export function sheetTracks(root: string, files: string[]): Set<string> {
  const tracks = new Set<string>();
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.cue' && ext !== '.gdi') continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), 'latin1');
    } catch {
      continue;
    }
    const dir = path.posix.dirname(rel);
    for (const name of ext === '.cue' ? cueFiles(text) : gdiFiles(text)) {
      tracks.add(path.posix.join(dir, name.replace(/\\/g, '/')).toLowerCase());
    }
  }
  return tracks;
}

export function cueFiles(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
    if (m) out.push((m[1] ?? m[2])!);
  }
  return out;
}

/** GDI lines after the track count: "<n> <lba> <type> <sector size> <file> <offset>". */
export function gdiFiles(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/.exec(line);
    if (m) out.push((m[1] ?? m[2])!);
  }
  return out;
}
