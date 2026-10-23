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

/**
 * Files that belong with a ROM and are useless without it (and vice versa):
 * - .cue / .gdi: the track files the sheet lists;
 * - .m3u: the discs it lists, plus their tracks;
 * - .img (CloneCD): the .ccd and .sub of the same name.
 * `onDisk` maps lower-cased relative paths to the real ones, since sheets
 * often disagree with the file system on case. Only files that exist are
 * returned, without duplicates or the ROM itself.
 */
export function companionPaths(root: string, rel: string, onDisk: Map<string, string>): string[] {
  const out = new Set<string>();
  const add = (p: string) => {
    const real = onDisk.get(p.toLowerCase());
    if (real && real !== rel) out.add(real);
    return real;
  };
  const listed = (sheet: string, parse: (text: string) => string[]) => {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, sheet), 'latin1');
    } catch {
      return [];
    }
    const at = path.posix.dirname(sheet);
    return parse(text).map((name) => path.posix.join(at, name.replace(/\\/g, '/')));
  };
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.cue') listed(rel, cueFiles).forEach(add);
  else if (ext === '.gdi') listed(rel, gdiFiles).forEach(add);
  else if (ext === '.m3u') {
    for (const disc of listed(rel, m3uFiles)) {
      const real = add(disc);
      if (real) for (const part of companionPaths(root, real, onDisk)) add(part);
    }
  } else if (ext === '.img') {
    const stem = rel.slice(0, -ext.length);
    add(`${stem}.ccd`);
    add(`${stem}.sub`);
  }
  return [...out];
}

/** Entries of an .m3u playlist: one path per line, "#" lines are comments. */
export function m3uFiles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
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
