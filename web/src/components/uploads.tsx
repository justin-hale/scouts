import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { upload, type Platform } from '../api';
import { faCheck, faCircleExclamation, faCloudArrowUp, Icon } from './icons';
import { Button, formatBytes, Input, Modal, Progress } from './ui';

type Item = { file: File; loaded: number; state: 'waiting' | 'uploading' | 'done' | 'error'; error?: string };

/** A drop zone that also opens the file chooser when clicked. */
export function DropZone({ onFiles, multiple, accept, children }: { onFiles: (files: File[]) => void; multiple?: boolean; accept?: string; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition ${
        over ? 'border-brand-500 bg-brand-600/10 text-brand-400' : 'border-stone-700 text-stone-400 hover:border-stone-500'
      }`}
    >
      <Icon icon={faCloudArrowUp} className="text-2xl" />
      {children}
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </button>
  );
}

/** Upload ROM files into a platform's ROM folder. The server scans them once they land. */
export function RomUpload({ platforms, initial, onClose, onUploaded }: { platforms: Platform[]; initial?: string; onClose: () => void; onUploaded: () => void }) {
  const usable = platforms.filter((p) => p.enabled && p.romPath);
  const [platform, setPlatform] = useState(initial && usable.some((p) => p.slug === initial) ? initial : (usable[0]?.slug ?? ''));
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const def = usable.find((p) => p.slug === platform);

  const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const start = async () => {
    setBusy(true);
    const dir = folder.trim().replace(/^\/+|\/+$/g, '');
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.state === 'done') continue;
      const file = items[i]!.file;
      update(i, { state: 'uploading', loaded: 0, error: undefined });
      const rel = dir ? `${dir}/${file.name}` : file.name;
      try {
        await upload(`/roms/upload?${new URLSearchParams({ platform, path: rel })}`, file, (loaded) => update(i, { loaded }));
        update(i, { state: 'done', loaded: file.size });
      } catch (e) {
        update(i, { state: 'error', error: (e as Error).message });
      }
    }
    setBusy(false);
    onUploaded();
  };

  if (!usable.length) {
    return (
      <Modal title="Upload ROMs" onClose={onClose}>
        <p className="text-sm text-stone-400">
          Set a ROM folder for at least one platform on the{' '}
          <Link to="/platforms" className="text-brand-400 underline">
            Platforms
          </Link>{' '}
          page first.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Upload ROMs" onClose={busy ? () => {} : onClose}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-stone-400">
          Platform
          <select
            className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-100"
            value={platform}
            disabled={busy}
            onChange={(e) => setPlatform(e.target.value)}
          >
            {usable.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-400">
          Into folder (optional)
          <Input className="mt-1" placeholder="e.g. Final Fantasy IX, or Zelda/mod" value={folder} disabled={busy} onChange={(e) => setFolder(e.target.value)} />
        </label>
      </div>
      <DropZone multiple onFiles={(files) => setItems((list) => [...list, ...files.map((file) => ({ file, loaded: 0, state: 'waiting' as const }))])}>
        <span>Drop ROMs here or click to choose</span>
        {def && <span className="text-xs text-stone-500">{def.romExtensions.join(' ')}</span>}
      </DropZone>
      {items.length > 0 && (
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {items.map((it, i) => (
            <li key={i} className="rounded-md border border-stone-800 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{it.file.name}</span>
                <span className="shrink-0 text-xs text-stone-500">
                  {it.state === 'done' ? (
                    <Icon icon={faCheck} className="text-emerald-400" />
                  ) : it.state === 'error' ? (
                    <Icon icon={faCircleExclamation} className="text-red-400" />
                  ) : (
                    formatBytes(it.file.size)
                  )}
                </span>
              </div>
              {it.state === 'uploading' && <Progress value={it.loaded} total={it.file.size} />}
              {it.error && <div className="mt-1 text-xs text-red-300">{it.error}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button variant="primary" onClick={start} disabled={busy || !items.some((it) => it.state !== 'done')}>
          <Icon icon={faCloudArrowUp} /> Upload {items.filter((it) => it.state !== 'done').length || ''}
        </Button>
      </div>
    </Modal>
  );
}

/** Upload a save for one game; the server works out where it belongs. */
export function SaveUpload({ gameId, onClose, onUploaded }: { gameId: number; onClose: () => void; onUploaded: () => void }) {
  const [status, setStatus] = useState<{ busy?: boolean; error?: string; done?: string } | null>(null);

  const send = async (file: File) => {
    setStatus({ busy: true });
    try {
      const r = await upload<{ changed: unknown[] }>(`/games/${gameId}/saves/upload?${new URLSearchParams({ name: file.name })}`, file);
      setStatus({ done: r.changed.length ? `Saved ${r.changed.length} file${r.changed.length > 1 ? 's' : ''}. Devices pick it up on their next sync.` : 'That save is already the current version.' });
      onUploaded();
    } catch (e) {
      setStatus({ error: (e as Error).message });
    }
  };

  return (
    <Modal title="Upload a save" onClose={onClose}>
      <DropZone onFiles={(files) => files[0] && send(files[0])}>
        <span>Drop a save here or click to choose</span>
        <span className="text-xs text-stone-500">.sav / .srm / .dsv for cartridge games, a .gci for GameCube, a .zip of the save folder for 3DS, Wii and PSP</span>
      </DropZone>
      {status?.busy && <p className="mt-3 text-sm text-stone-400">Uploading…</p>}
      {status?.error && <p className="mt-3 text-sm text-red-300">{status.error}</p>}
      {status?.done && <p className="mt-3 text-sm text-emerald-300">{status.done}</p>}
      <p className="mt-4 text-xs text-stone-500">The previous version stays in the save's history, so nothing is lost.</p>
    </Modal>
  );
}
