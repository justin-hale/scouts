import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { coverUrl, get, patch, post, type Candidate, type GameDetail, type SaveVersion } from '../api';
import { Badge, Button, Card, ErrorNote, formatBytes, formatTime, Input, Modal, useApi } from '../components/ui';

export default function Game() {
  const id = Number(useParams().id);
  const game = useApi(() => get<GameDetail>(`/games/${id}`), [id]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const g = game.data;
  if (!g) return <ErrorNote error={game.error} />;

  const auto = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ changed: boolean }>(`/games/${id}/metadata/auto`);
      if (!r.changed) setError('No confident match found. Try searching manually.');
      await game.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to={`/library?platform=${g.platform}`} className="mb-4 inline-block text-sm text-stone-400 hover:text-stone-200">
        ← Library
      </Link>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-48 shrink-0">
          <div className="aspect-[3/4] overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
            {g.cover ? (
              <img src={coverUrl(g.cover)!} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-stone-500">No cover</div>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-stone-50">{g.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{g.platform}</Badge>
            {g.releaseDate && <Badge>{g.releaseDate}</Badge>}
            {g.titleId && <Badge tone="sky">Title ID {g.titleId}</Badge>}
            {g.metadataSource && <Badge tone="green">{g.metadataSource}</Badge>}
          </div>
          {g.summary && <p className="mt-4 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-stone-300">{g.summary}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={auto} disabled={busy}>
              Auto-match
            </Button>
            <Button onClick={() => setSearching(true)}>Search metadata…</Button>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-stone-100">Saves</h2>
      {g.saves.length === 0 ? (
        <p className="text-sm text-stone-500">No saves yet. They appear here once a device syncs or a file is found in the server save folder.</p>
      ) : (
        <div className="space-y-3">
          {g.saves.map((s) => (
            <SaveCard key={s.id} save={s} onChange={game.reload} />
          ))}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-semibold text-stone-100">ROM files</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2">File</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">CRC32</th>
              <th className="px-4 py-2">SHA-1</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {g.roms.map((r) => (
              <tr key={r.id} className="border-t border-stone-800">
                <td className="px-4 py-2">
                  {r.relPath} {r.missing ? <Badge tone="red">missing</Badge> : null}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{formatBytes(r.size)}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.crc32}</td>
                <td className="px-4 py-2 font-mono text-xs break-all">{r.sha1}</td>
                <td className="px-4 py-2">
                  {!r.missing && (
                    <a className="text-ember-400 hover:underline" href={`/api/roms/${r.id}/download`}>
                      Download
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {searching && <MetadataSearch game={g} onClose={() => setSearching(false)} onApplied={game.reload} />}
      {editing && <EditGame game={g} onClose={() => setEditing(false)} onSaved={game.reload} />}
    </>
  );
}

function SaveCard({ save, onChange }: { save: GameDetail['saves'][number]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const versions = useApi(() => (open ? get<SaveVersion[]>(`/saves/${save.id}/versions`) : Promise.resolve([])), [open, save.currentVersionId]);

  const restore = async (versionId: number) => {
    await post(`/saves/${save.id}/restore`, { versionId });
    onChange();
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-stone-100">{save.file}</div>
          <div className="mt-1 text-xs text-stone-500">
            {formatBytes(save.size)} · updated {formatTime(save.updatedAt)} {save.updatedBy && `by ${save.updatedBy}`} · {save.versionCount}{' '}
            version{save.versionCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex gap-2">
          {save.currentVersionId && (
            <a
              href={`/api/save-versions/${save.currentVersionId}/download`}
              className="rounded-md border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100 hover:bg-stone-700"
            >
              Download
            </a>
          )}
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Hide history' : 'History'}
          </Button>
        </div>
      </div>
      {open && (
        <table className="mt-4 w-full text-sm">
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v.id} className="border-t border-stone-800">
                <td className="py-2 pr-3 whitespace-nowrap">{formatTime(v.createdAt)}</td>
                <td className="py-2 pr-3">{v.device ?? 'server'}</td>
                <td className="py-2 pr-3">{formatBytes(v.size)}</td>
                <td className="py-2 pr-3 font-mono text-xs text-stone-500">{v.sha256.slice(0, 12)}</td>
                <td className="py-2 pr-3 text-xs text-stone-400">{v.note}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {v.isCurrent ? (
                    <Badge tone="green">current</Badge>
                  ) : (
                    <Button variant="ghost" onClick={() => restore(v.id)}>
                      Restore
                    </Button>
                  )}
                  <a className="ml-2 text-xs text-ember-400 hover:underline" href={`/api/save-versions/${v.id}/download`}>
                    download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function MetadataSearch({ game, onClose, onApplied }: { game: GameDetail; onClose: () => void; onApplied: () => void }) {
  const [query, setQuery] = useState(game.title);
  const [results, setResults] = useState<{ candidates: Candidate[]; providers: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      setResults(await post(`/games/${game.id}/metadata/search`, { query }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (c: Candidate) => {
    setBusy(true);
    try {
      await post(`/games/${game.id}/metadata/apply`, { provider: c.provider, id: c.id });
      onApplied();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Search metadata" onClose={onClose}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <Button variant="primary" disabled={busy}>
          Search
        </Button>
      </form>
      <ErrorNote error={error} />
      {results && results.providers.length === 0 && (
        <p className="text-sm text-stone-400">
          No metadata providers are configured. Add IGDB or SteamGridDB keys in{' '}
          <Link to="/settings" className="text-ember-400 underline">
            Settings
          </Link>
          .
        </p>
      )}
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {results?.candidates.map((c) => (
          <button
            key={`${c.provider}-${c.id}`}
            disabled={busy}
            onClick={() => apply(c)}
            className="flex w-full gap-3 rounded-lg border border-stone-800 p-2 text-left hover:border-ember-500 hover:bg-stone-800/50"
          >
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-stone-800">
              {c.coverUrl && <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-stone-100">
                {c.name} {c.year && <span className="text-stone-500">({c.year})</span>}
              </div>
              <Badge tone={c.provider === 'igdb' ? 'sky' : 'ember'}>{c.provider === 'igdb' ? 'IGDB' : 'SteamGridDB cover'}</Badge>
              {c.summary && <p className="mt-1 line-clamp-2 text-xs text-stone-400">{c.summary}</p>}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function EditGame({ game, onClose, onSaved }: { game: GameDetail; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(game.title);
  const [titleId, setTitleId] = useState(game.titleId ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await patch(`/games/${game.id}`, { title, titleId: titleId || null });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Edit game" onClose={onClose}>
      <ErrorNote error={error} />
      <label className="mb-1 block text-xs text-stone-400">Title</label>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="mt-4 mb-1 block text-xs text-stone-400">Title ID / serial (3DS title ID, PSP serial…)</label>
      <Input value={titleId} onChange={(e) => setTitleId(e.target.value)} placeholder="e.g. 00040000000a5e00" />
      <p className="mt-1 text-xs text-stone-500">Saves are matched to this game by this ID on platforms that key saves by title.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
