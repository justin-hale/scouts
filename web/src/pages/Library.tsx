import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coverUrl, get, type GameSummary, type Platform } from '../api';
import { faCloudArrowUp, faFloppyDisk, Icon } from '../components/icons';
import { JobButton, startScan, startScrape } from '../components/jobs';
import { PlatformLogo } from '../components/PlatformLogo';
import { Button, ErrorNote, Input, PageHeader, useApi } from '../components/ui';
import { RomUpload } from '../components/uploads';

// The server does the sorting (see server/src/library/order.ts), so every client offers the same orders.
const GAME_SORTS = [
  ['title', 'Title A–Z'],
  ['title-desc', 'Title Z–A'],
  ['added', 'Recently added'],
  ['released', 'Release date'],
  ['saved', 'Recently saved'],
] as const;
const PLATFORM_SORTS = [
  ['name', 'Platforms A–Z'],
  ['games', 'Most games first'],
] as const;
type GameSort = (typeof GAME_SORTS)[number][0];
type PlatformSort = (typeof PLATFORM_SORTS)[number][0];

/** A sort choice kept in this browser (it may be unavailable, e.g. in a private window). */
function useStoredChoice<T extends string>(key: string, allowed: readonly (readonly [T, string])[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (allowed.some(([v]) => v === saved)) return saved as T;
    } catch {
      // fall through to the default
    }
    return allowed[0][0];
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // only remembered for this visit
    }
  };
  return [value, set] as const;
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [uploading, setUploading] = useState(false);
  const [sort, setSort] = useStoredChoice<GameSort>('romsafe.library.sort', GAME_SORTS);
  const [platformSort, setPlatformSort] = useStoredChoice<PlatformSort>('romsafe.library.platformSort', PLATFORM_SORTS);

  const platforms = useApi(() => get<Platform[]>(`/platforms?sort=${platformSort}`), [platformSort]);
  const games = useApi(
    () =>
      get<{ items: GameSummary[]; total: number }>(
        `/games?${new URLSearchParams({ ...(platform && { platform }), ...(q && { q }), sort, platformSort, limit: '500' })}`,
      ),
    [platform, q, sort, platformSort],
  );
  const reload = useCallback(() => {
    void games.reload();
    void platforms.reload();
  }, [games.reload, platforms.reload]);

  const withGames = (platforms.data ?? []).filter((p) => p.counts.games > 0);
  const names = new Map((platforms.data ?? []).map((p) => [p.slug, p.name]));
  const setPlatform = (slug: string) => setParams(slug ? { platform: slug } : {});

  return (
    <>
      <PageHeader
        title="Library"
        subtitle={games.data ? `${games.data.total} games` : undefined}
        actions={
          <>
            <Button onClick={() => setUploading(true)}>
              <Icon icon={faCloudArrowUp} /> Upload ROMs
            </Button>
            <JobButton label="Scan library" statusUrl="/library/scan" start={() => startScan()} onFinished={reload} />
            <JobButton
              label="Scrape metadata"
              statusUrl="/metadata/scrape"
              start={() => startScrape(platform || undefined)}
              onFinished={reload}
              variant="primary"
            />
          </>
        }
      />
      <ErrorNote error={games.error ?? platforms.error} />

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <Input className="md:max-w-xs" placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          <SortSelect label="Sort games" value={sort} options={GAME_SORTS} onChange={setSort} />
          <SortSelect label="Order platforms" value={platformSort} options={PLATFORM_SORTS} onChange={setPlatformSort} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!platform} onClick={() => setPlatform('')}>
            All
          </Chip>
          {withGames.map((p) => (
            <Chip key={p.slug} active={platform === p.slug} onClick={() => setPlatform(p.slug)}>
              {p.name} <span className="opacity-60">{p.counts.games}</span>
            </Chip>
          ))}
        </div>
      </div>

      {games.data && games.data.total === 0 && (
        <div className="rounded-xl border border-dashed border-stone-700 p-10 text-center text-stone-400">
          No games yet. Set ROM folders on the{' '}
          <Link className="text-brand-400 underline" to="/platforms">
            Platforms
          </Link>{' '}
          page, then scan your library.
        </div>
      )}

      {/* The server groups by platform, then sorts within each; in the All view each platform gets a heading. */}
      {groupByPlatform(games.data?.items ?? []).map(([slug, list]) => (
        <section key={slug} className="mb-10">
          {!platform && (
            <h2 className="mb-4 flex items-center gap-3 border-b border-stone-800 pb-2">
              <PlatformLogo slug={slug} name={names.get(slug) ?? slug} className="max-w-48" />
              <span className="text-sm text-stone-400">{names.get(slug) ?? slug}</span>
              <span className="text-xs text-stone-600">{list.length}</span>
            </h2>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7">
            {list.map((g) => (
              <GameTile key={g.id} game={g} platformName={names.get(g.platform) ?? g.platform} />
            ))}
          </div>
        </section>
      ))}

      {uploading && platforms.data && (
        <RomUpload
          platforms={platforms.data}
          initial={platform}
          onClose={() => setUploading(false)}
          // The server scans uploads itself; refresh once that's likely done.
          onUploaded={() => setTimeout(reload, 3000)}
        />
      )}
    </>
  );
}

function groupByPlatform(items: GameSummary[]): [string, GameSummary[]][] {
  const groups: [string, GameSummary[]][] = [];
  for (const g of items) {
    const last = groups[groups.length - 1];
    if (last?.[0] === g.platform) last[1].push(g);
    else groups.push([g.platform, [g]]);
  }
  return groups;
}

function GameTile({ game: g, platformName }: { game: GameSummary; platformName: string }) {
  return (
    <Link to={`/games/${g.id}`} className="group">
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
        {g.cover ? (
          <img src={coverUrl(g.cover)!} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 pb-12 text-center text-sm text-stone-500">{g.title}</div>
        )}
        {/* Darken the bottom of the art so the platform logo and save marker read on any cover. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-2/5 items-end justify-between gap-2 bg-gradient-to-b from-transparent via-black/40 to-black/90 px-2.5 pb-2">
          <PlatformLogo slug={g.platform} name={platformName} className="max-w-[65%] min-w-0" />
          {g.saveCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-base text-brand-400 drop-shadow" title={`${g.saveCount} save${g.saveCount > 1 ? 's' : ''}`}>
              <Icon icon={faFloppyDisk} />
              {g.saveCount > 1 && <span className="text-xs font-semibold text-stone-100">{g.saveCount}</span>}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-medium text-stone-200 group-hover:text-brand-400">{g.title}</div>
    </Link>
  );
}

function SortSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      className="rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? 'border-brand-500 bg-brand-600/20 text-brand-400' : 'border-stone-700 text-stone-400 hover:border-stone-500'
      }`}
    >
      {children}
    </button>
  );
}
