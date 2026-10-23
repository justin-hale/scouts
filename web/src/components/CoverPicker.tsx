import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, upload, type CoverOption } from '../api';
import { faImage, faMagnifyingGlass, Icon } from './icons';
import { DropZone } from './uploads';
import { Badge, Button, ErrorNote, Input, Modal, useApi } from './ui';

const PROVIDER = { igdb: 'IGDB', steamgriddb: 'SteamGridDB', libretro: 'libretro' } as const;

/** Pick a game's cover from IGDB, SteamGridDB or libretro, or upload one. */
export function CoverPicker({ gameId, title, onClose, onPicked }: { gameId: number; title: string; onClose: () => void; onPicked: () => void }) {
  const [query, setQuery] = useState(title);
  const [search, setSearch] = useState(title);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CoverOption['provider'] | ''>('');
  const options = useApi(() => get<{ covers: CoverOption[]; providers: string[] }>(`/games/${gameId}/covers?${new URLSearchParams({ q: search })}`), [gameId, search]);

  const choose = async (run: () => Promise<unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await run();
      onPicked();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const covers = (options.data?.covers ?? []).filter((c) => !filter || c.provider === filter);
  const counts = new Map<string, number>();
  for (const c of options.data?.covers ?? []) counts.set(c.provider, (counts.get(c.provider) ?? 0) + 1);
  const missingKeys = options.data && !options.data.providers.includes('igdb') && !options.data.providers.includes('steamgriddb');

  return (
    <Modal title="Choose a cover" onClose={onClose}>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" disabled={options.loading}>
          <Icon icon={faMagnifyingGlass} /> Search
        </Button>
      </form>
      <ErrorNote error={error ?? options.error} />
      {missingKeys && (
        <p className="mb-3 text-sm text-stone-400">
          Only libretro box art is available. Add IGDB and SteamGridDB keys in{' '}
          <Link to="/settings" className="text-brand-400 underline">
            Settings
          </Link>{' '}
          for many more covers.
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', 'igdb', 'steamgriddb', 'libretro'] as const)
          .filter((p) => !p || counts.has(p))
          .map((p) => (
            <button
              key={p || 'all'}
              onClick={() => setFilter(p)}
              className={`rounded-full border px-3 py-1 text-xs ${filter === p ? 'border-brand-500 bg-brand-600/20 text-brand-400' : 'border-stone-700 text-stone-400 hover:border-stone-500'}`}
            >
              {p ? PROVIDER[p] : 'All'} <span className="opacity-60">{p ? counts.get(p) : options.data?.covers.length}</span>
            </button>
          ))}
      </div>
      {options.loading && <p className="py-8 text-center text-sm text-stone-500">Looking for covers…</p>}
      {!options.loading && covers.length === 0 && <p className="py-8 text-center text-sm text-stone-500">No covers found. Try another search.</p>}
      <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
        {!options.loading &&
          covers.map((c) => (
            <button
              key={c.url}
              disabled={!!busy}
              onClick={() => choose(() => post(`/games/${gameId}/cover`, { url: c.url }), c.url)}
              className={`group text-left disabled:opacity-50 ${busy === c.url ? 'animate-pulse' : ''}`}
              title={c.label}
            >
              <div className="aspect-[3/4] overflow-hidden rounded-md border border-stone-800 bg-stone-800 group-hover:border-brand-500">
                <img src={c.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="mt-1 flex items-center gap-1">
                <Badge tone={c.provider === 'igdb' ? 'sky' : c.provider === 'steamgriddb' ? 'brand' : 'stone'}>{PROVIDER[c.provider]}</Badge>
              </div>
              <div className="mt-0.5 line-clamp-1 text-xs text-stone-500">{c.label}</div>
            </button>
          ))}
      </div>
      <div className="mt-4 border-t border-stone-800 pt-4">
        <DropZone accept="image/png,image/jpeg,image/webp" onFiles={(files) => files[0] && choose(() => upload(`/games/${gameId}/cover/upload`, files[0]!), 'upload')}>
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={faImage} /> Or drop your own image (PNG, JPEG, WebP)
          </span>
        </DropZone>
      </div>
    </Modal>
  );
}
