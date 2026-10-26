import { PLATFORMS_BY_NAME } from '../platforms.js';

/**
 * How library lists are ordered, shared by the web GUI's and the devices' endpoints
 * so every client offers the same sorts without doing it itself.
 */
export const GAME_SORTS = ['title', 'title-desc', 'added', 'released', 'saved'] as const;
export const PLATFORM_SORTS = ['name', 'games'] as const;
export type GameSort = (typeof GAME_SORTS)[number];
export type PlatformSort = (typeof PLATFORM_SORTS)[number];

const pick = <T extends string>(allowed: readonly T[], value: unknown, what: string): T => {
  if (value === undefined || value === '') return allowed[0];
  if (!allowed.includes(value as T)) {
    throw Object.assign(new Error(`${what} must be one of ${allowed.join(', ')}`), { statusCode: 400 });
  }
  return value as T;
};

export const parseGameSort = (v: unknown) => pick(GAME_SORTS, v, 'sort');
export const parsePlatformSort = (v: unknown) => pick(PLATFORM_SORTS, v, 'platformSort');

/** SQL that ranks a platform slug column alphabetically by platform name. */
export const platformNameRank = (column: string) =>
  `CASE ${column} ${PLATFORMS_BY_NAME.map((p, i) => `WHEN '${p.slug}' THEN ${i}`).join(' ')} ELSE ${PLATFORMS_BY_NAME.length} END`;

/**
 * ORDER BY terms for games (aliased `g`): grouped by platform, then sorted inside each platform.
 * "games" puts the platforms with the most games in the library first.
 */
export function gameOrderBy(sort: GameSort, platformSort: PlatformSort): string {
  const platform =
    platformSort === 'games'
      ? `(SELECT count(*) FROM games pg WHERE pg.platform = g.platform) DESC, ${platformNameRank('g.platform')}`
      : platformNameRank('g.platform');
  const title = 'g.title COLLATE NOCASE';
  const within = {
    title,
    'title-desc': `${title} DESC`,
    added: `g.created_at DESC, g.id DESC, ${title}`,
    released: `g.release_date IS NULL, g.release_date DESC, ${title}`,
    // When the current copy of any of the game's saves last changed; games without saves go last.
    saved: `(SELECT max(v.created_at) FROM saves s JOIN save_versions v ON v.id = s.current_version_id
               WHERE s.game_id = g.id) DESC NULLS LAST, ${title}`,
  }[sort];
  return `${platform}, ${within}`;
}

/** Sorts platforms by name, or by game count (most first, ties by name). */
export function sortPlatforms<T extends { name: string }>(list: T[], sort: PlatformSort, games: (p: T) => number): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  return [...list].sort(sort === 'games' ? (a, b) => games(b) - games(a) || byName(a, b) : byName);
}
