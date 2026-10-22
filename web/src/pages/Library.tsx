import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coverUrl, get, type GameSummary, type Platform } from '../api';
import { JobButton, startScan, startScrape } from '../components/jobs';
import { Badge, ErrorNote, Input, PageHeader, useApi } from '../components/ui';

export default function Library() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  const platforms = useApi(() => get<Platform[]>('/platforms'));
  const games = useApi(
    () => get<{ items: GameSummary[]; total: number }>(`/games?${new URLSearchParams({ ...(platform && { platform }), ...(q && { q }), limit: '500' })}`),
    [platform, q],
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
          <Link className="text-ember-400 underline" to="/platforms">
            Platforms
          </Link>{' '}
          page, then scan your library.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7">
        {games.data?.items.map((g) => (
          <Link key={g.id} to={`/games/${g.id}`} className="group">
            <div className="aspect-[3/4] overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
              {g.cover ? (
                <img src={coverUrl(g.cover)!} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="flex h-full items-center justify-center p-3 text-center text-sm text-stone-500">{g.title}</div>
              )}
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-medium text-stone-200 group-hover:text-ember-400">{g.title}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge>{names.get(g.platform) ?? g.platform}</Badge>
              {g.saveCount > 0 && <Badge tone="ember">{g.saveCount} save{g.saveCount > 1 ? 's' : ''}</Badge>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? 'border-ember-500 bg-ember-600/20 text-ember-400' : 'border-stone-700 text-stone-400 hover:border-stone-500'
      }`}
    >
      {children}
    </button>
  );
}
