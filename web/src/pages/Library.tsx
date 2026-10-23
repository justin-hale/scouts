import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coverUrl, get, type GameSummary, type Platform } from '../api';
import { faCloudArrowUp, faFloppyDisk, Icon } from '../components/icons';
import { JobButton, startScan, startScrape } from '../components/jobs';
import { PlatformLogo } from '../components/PlatformLogo';
import { Button, ErrorNote, Input, PageHeader, useApi } from '../components/ui';
import { RomUpload } from '../components/uploads';

export default function Library() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [uploading, setUploading] = useState(false);

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7">
        {games.data?.items.map((g) => (
          <Link key={g.id} to={`/games/${g.id}`} className="group">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
              {g.cover ? (
                <img src={coverUrl(g.cover)!} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="flex h-full items-center justify-center p-3 pb-12 text-center text-sm text-stone-500">{g.title}</div>
              )}
              {/* Darken the bottom of the art so the platform logo and save marker read on any cover. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-2/5 items-end justify-between gap-2 bg-gradient-to-b from-transparent via-black/40 to-black/90 px-2.5 pb-2">
                <PlatformLogo slug={g.platform} name={names.get(g.platform) ?? g.platform} className="max-w-[65%] min-w-0" />
                {g.saveCount > 0 && (
                  <span
                    className="flex shrink-0 items-center gap-1 text-base text-brand-400 drop-shadow"
                    title={`${g.saveCount} save${g.saveCount > 1 ? 's' : ''}`}
                  >
                    <Icon icon={faFloppyDisk} />
                    {g.saveCount > 1 && <span className="text-xs font-semibold text-stone-100">{g.saveCount}</span>}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-medium text-stone-200 group-hover:text-brand-400">{g.title}</div>
          </Link>
        ))}
      </div>

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
