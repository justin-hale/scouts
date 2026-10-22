import path from 'node:path';

/** File name without its extension ("Metroid (USA).gba" -> "Metroid (USA)"). */
export function fileStem(fileName: string): string {
  const base = path.posix.basename(fileName.replace(/\\/g, '/'));
  const ext = path.posix.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Human title from a ROM file name, dropping No-Intro/Redump style tags:
 * "Legend of Zelda, The - The Minish Cap (USA) [!]" -> "The Legend of Zelda - The Minish Cap".
 */
export function cleanTitle(fileName: string): string {
  let t = fileStem(fileName)
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "Name, The - Subtitle" / "Name, The"
  t = t.replace(/^(.+?), (The|A|An)(\s+-\s+.*|:.*)?$/i, (_m, name: string, article: string, rest = '') => `${article} ${name}${rest}`);
  return t || fileStem(fileName);
}

/** Lower-case, punctuation-free form used to compare titles from different sources. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}
