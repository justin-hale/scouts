import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { coverUrl, get, patch, post, type Candidate, type GameDetail } from '../api';
import { CoverPicker } from '../components/CoverPicker';
import { faArrowLeft, faCloudArrowUp, faDownload, faImage, faPuzzlePiece, Icon } from '../components/icons';
import { SaveCard } from '../components/SaveCard';
import { SaveUpload } from '../components/uploads';
import { Badge, Button, Card, ErrorNote, formatBytes, Input, Modal, useApi } from '../components/ui';

export default function Game() {
  const id = Number(useParams().id);
  const game = useApi(() => get<GameDetail>(`/games/${id}`), [id]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [uploadingSave, setUploadingSave] = useState(false);
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
      <Link to={`/library?platform=${g.platform}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200">
        <Icon icon={faArrowLeft} /> Library
      </Link>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-48 shrink-0">
          <button
            onClick={() => setPickingCover(true)}
            className="group relative block aspect-[3/4] w-full overflow-hidden rounded-lg border border-stone-800 bg-stone-900"
            title="Change cover"
          >
            {g.cover ? (
              <img src={coverUrl(g.cover)!} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-stone-500">No cover</div>
            )}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/70 py-2 text-xs text-stone-100 opacity-0 transition group-hover:opacity-100">
              <Icon icon={faImage} /> Change cover
            </span>
          </button>
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

      <div className="mt-10 mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-100">Saves</h2>
        <Button onClick={() => setUploadingSave(true)}>
          <Icon icon={faCloudArrowUp} /> Upload save
        </Button>
      </div>
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
                  {!r.missing && <DownloadLink href={`/api/roms/${r.id}/download`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {g.extras.length > 0 && (
        <>
          <h2 className="mt-10 mb-1 flex items-center gap-2 text-lg font-semibold text-stone-100">
            <Icon icon={faPuzzlePiece} className="text-stone-500" /> Extras
          </h2>
          <p className="mb-3 text-sm text-stone-500">DLC, mods, hacks, patches and other files kept in this game's side folders.</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {g.extras.map((x) => (
                  <tr key={x.id} className="border-t border-stone-800 first:border-t-0">
                    <td className="px-4 py-2">
                      <Badge tone="brand">{x.kind}</Badge>
                    </td>
                    <td className="px-4 py-2 break-all">
                      {x.relPath} {x.missing ? <Badge tone="red">missing</Badge> : null}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatBytes(x.size)}</td>
                    <td className="px-4 py-2">{!x.missing && <DownloadLink href={`/api/extras/${x.id}/download`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {searching && <MetadataSearch game={g} onClose={() => setSearching(false)} onApplied={game.reload} />}
      {editing && <EditGame game={g} onClose={() => setEditing(false)} onSaved={game.reload} />}
      {pickingCover && <CoverPicker gameId={g.id} title={g.title} onClose={() => setPickingCover(false)} onPicked={game.reload} />}
      {uploadingSave && <SaveUpload gameId={g.id} onClose={() => setUploadingSave(false)} onUploaded={game.reload} />}
    </>
  );
}

function DownloadLink({ href }: { href: string }) {
  return (
    <a className="inline-flex items-center gap-1.5 whitespace-nowrap text-brand-400 hover:underline" href={href}>
      <Icon icon={faDownload} /> Download
    </a>
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
          <Link to="/settings" className="text-brand-400 underline">
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
            className="flex w-full gap-3 rounded-lg border border-stone-800 p-2 text-left hover:border-brand-500 hover:bg-stone-800/50"
          >
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-stone-800">
              {c.coverUrl && <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-stone-100">
                {c.name} {c.year && <span className="text-stone-500">({c.year})</span>}
              </div>
              <Badge tone={c.provider === 'igdb' ? 'sky' : 'brand'}>{c.provider === 'igdb' ? 'IGDB' : 'SteamGridDB cover'}</Badge>
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
