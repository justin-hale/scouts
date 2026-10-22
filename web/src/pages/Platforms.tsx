import { useState } from 'react';
import { get, put, type Platform } from '../api';
import { startScan } from '../components/jobs';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, useApi } from '../components/ui';

export default function Platforms() {
  const platforms = useApi(() => get<Platform[]>('/platforms'));
  const [showAll, setShowAll] = useState(false);

  const list = (platforms.data ?? []).filter((p) => showAll || p.romPath || p.savePath);
  const hidden = (platforms.data?.length ?? 0) - list.length;

  return (
    <>
      <PageHeader
        title="Platforms"
        subtitle="Where each platform's ROMs and primary save backups live on this server. Paths are as the server sees them (inside the container)."
        actions={
          <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Only configured' : `Show all platforms${hidden ? ` (+${hidden})` : ''}`}
          </Button>
        }
      />
      <ErrorNote error={platforms.error} />
      {list.length === 0 && platforms.data && (
        <Card className="p-6 text-sm text-stone-400">
          Nothing configured yet. Click <b>Show all platforms</b> and fill in the folders for the systems you use.
        </Card>
      )}
      <div className="space-y-4">
        {list.map((p) => (
          <PlatformCard key={p.slug} platform={p} onSaved={platforms.reload} />
        ))}
      </div>
    </>
  );
}

function PlatformCard({ platform: p, onSaved }: { platform: Platform; onSaved: () => void }) {
  const [romPath, setRomPath] = useState(p.romPath ?? '');
  const [savePath, setSavePath] = useState(p.savePath ?? '');
  const [layout, setLayout] = useState(p.saveLayoutOverride ?? '');
  const [enabled, setEnabled] = useState(p.enabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    romPath !== (p.romPath ?? '') || savePath !== (p.savePath ?? '') || layout !== (p.saveLayoutOverride ?? '') || enabled !== p.enabled;

  const save = async () => {
    setError(null);
    try {
      await put(`/platforms/${p.slug}`, { romPath, savePath, saveLayout: layout, enabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-stone-100">{p.name}</h2>
          <Badge>{p.slug}</Badge>
          <span className="text-xs text-stone-500">
            {p.counts.games} games · {p.counts.roms} ROMs · {p.counts.saves} saves
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-400">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-brand-500" />
          Enabled
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="ROM folder" hint={`Scanned for ${p.romExtensions.join(' ')}`}>
          <Input value={romPath} onChange={(e) => setRomPath(e.target.value)} placeholder={`/library/roms/${p.slug}`} />
        </Field>
        <Field label="Save folder" hint="Primary backup: the current version of every save is kept here as plain files.">
          <Input value={savePath} onChange={(e) => setSavePath(e.target.value)} placeholder={`/library/saves/${p.slug}`} />
        </Field>
        <div className="md:col-span-2">
          <Field
            label="Save layout inside the save folder"
            hint={
              <>
                Leave blank for the default. Saves are keyed by{' '}
                {
                  { rom: 'ROM file name', titleId: 'title ID', saveDir: 'save folder name', card: 'memory card (shared by many games)' }[
                    p.keyKind
                  ]
                }. Emulator profiles
                that support this platform: {p.profiles.join(', ') || 'none'}.
              </>
            }
          >
            <Input className="font-mono" value={layout} onChange={(e) => setLayout(e.target.value)} placeholder={p.defaultSaveLayout} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {saved && <span className="self-center text-sm text-emerald-400">Saved</span>}
        <Button onClick={() => startScan([p.slug])} disabled={dirty || (!p.romPath && !p.savePath)}>
          Scan
        </Button>
        <Button variant="primary" onClick={save} disabled={!dirty}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}
