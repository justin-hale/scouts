import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post, put, type DeviceDetail, type Platform } from '../api';
import { Badge, Button, Card, ErrorNote, formatBytes, Input, PageHeader, timeAgo, useApi } from '../components/ui';

interface DeviceRoms {
  serverRoms: { romId: number; fileName: string; size: number; gameTitle: string | null; localPath: string | null; queued: number }[];
  unmatched: { id: number; localPath: string; size: number; matchKind: string }[];
}

export default function DevicePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const device = useApi(() => get<DeviceDetail>(`/devices/${id}`), [id]);
  const platforms = useApi(() => get<Platform[]>('/platforms'));
  const [platform, setPlatform] = useState('');
  const [error, setError] = useState<string | null>(null);

  const d = device.data;
  const platformNames = new Map((platforms.data ?? []).map((p) => [p.slug, p.name]));
  const romPlatforms = (platforms.data ?? []).filter((p) => p.counts.roms > 0);

  if (!d) return <ErrorNote error={device.error} />;

  // Start on a platform this device has mapped, if it has ROMs on the server.
  const mappedWithRoms = romPlatforms.find((p) => d.mappings.some((m) => m.platform === p.slug));
  const selected = platform || mappedWithRoms?.slug || romPlatforms[0]?.slug || '';

  const rename = async () => {
    const name = prompt('Device name', d.name);
    if (!name) return;
    await patch(`/devices/${id}`, { name }).catch((e) => setError(e.message));
    void device.reload();
  };

  const remove = async () => {
    if (!confirm(`Unpair ${d.name}? The app on it will need to be paired again. Saves already on the server are kept.`)) return;
    await del(`/devices/${id}`);
    navigate('/devices');
  };

  return (
    <>
      <PageHeader
        title={d.name}
        subtitle={
          <>
            <Badge tone="sky">{d.kind}</Badge> <span className="ml-2">Last seen {timeAgo(d.lastSeenAt)}</span>
          </>
        }
        actions={
          <>
            <Button variant="ghost" onClick={rename}>
              Rename
            </Button>
            <Button variant="danger" onClick={remove}>
              Unpair
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />

      <h2 className="mb-3 text-lg font-semibold text-stone-100">Folder mappings</h2>
      <p className="mb-3 text-sm text-stone-400">Chosen in the app on the device: which emulator each platform uses and where its saves and ROMs live.</p>
      <Card className="mb-10 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2">Platform</th>
              <th className="px-4 py-2">Emulator profile</th>
              <th className="px-4 py-2">Save folder</th>
              <th className="px-4 py-2">ROM folder</th>
              <th className="px-4 py-2">ROMs on device</th>
            </tr>
          </thead>
          <tbody>
            {d.mappings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-stone-500">
                  No platforms mapped on this device yet.
                </td>
              </tr>
            )}
            {d.mappings.map((m) => {
              const roms = d.romSummary.find((r) => r.platform === m.platform);
              return (
                <tr key={m.platform} className="border-t border-stone-800">
                  <td className="px-4 py-2">{platformNames.get(m.platform) ?? m.platform}</td>
                  <td className="px-4 py-2">
                    <Badge tone="ember">{m.profile}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs break-all text-stone-400">{m.saveRoot ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs break-all text-stone-400">{m.romRoot ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{roms ? `${roms.matched}/${roms.files} matched` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-100">ROMs</h2>
        <select
          className="rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm"
          value={selected}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {romPlatforms.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {selected ? <RomTable deviceId={id} platform={selected} /> : <p className="text-sm text-stone-500">Scan a ROM folder first.</p>}
    </>
  );
}

function RomTable({ deviceId, platform }: { deviceId: number; platform: string }) {
  const roms = useApi(() => get<DeviceRoms>(`/devices/${deviceId}/roms?platform=${platform}`), [deviceId, platform]);
  const [filter, setFilter] = useState<'all' | 'missing' | 'on'>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const rows = useMemo(
    () =>
      (roms.data?.serverRoms ?? []).filter(
        (r) =>
          (filter === 'all' || (filter === 'on' ? !!r.localPath : !r.localPath)) &&
          (!q || r.fileName.toLowerCase().includes(q.toLowerCase())),
      ),
    [roms.data, filter, q],
  );

  const queue = async (romIds: number[]) => {
    await post(`/devices/${deviceId}/queue`, { romIds });
    setPicked(new Set());
    void roms.reload();
  };
  const unqueue = async (romId: number) => {
    await del(`/devices/${deviceId}/queue/${romId}`);
    void roms.reload();
  };
  const match = async (deviceRomId: number, romId: number | null) => {
    await put(`/devices/${deviceId}/roms/${deviceRomId}`, { romId });
    void roms.reload();
  };

  const toggle = (romId: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(romId)) n.delete(romId);
      else n.add(romId);
      return n;
    });

  return (
    <>
      <ErrorNote error={roms.error} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(['all', 'missing', 'on'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'default' : 'ghost'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'missing' ? 'Not on device' : 'On device'}
          </Button>
        ))}
        <Button variant="primary" className="ml-auto" disabled={picked.size === 0} onClick={() => queue([...picked])}>
          Send {picked.size || ''} to device
        </Button>
      </div>
      <Card className="mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.romId} className="border-t border-stone-800 first:border-t-0">
                <td className="w-8 px-4 py-2">
                  {!r.localPath && !r.queued && (
                    <input type="checkbox" className="accent-ember-500" checked={picked.has(r.romId)} onChange={() => toggle(r.romId)} />
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="text-stone-100">{r.fileName}</div>
                  {r.localPath && r.localPath !== r.fileName && <div className="text-xs text-stone-500">on device as {r.localPath}</div>}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-stone-400">{formatBytes(r.size)}</td>
                <td className="py-2 pr-4 text-right whitespace-nowrap">
                  {r.localPath ? (
                    <Badge tone="green">on device</Badge>
                  ) : r.queued ? (
                    <>
                      <Badge tone="ember">queued</Badge>{' '}
                      <button className="text-xs text-stone-500 hover:text-stone-300" onClick={() => unqueue(r.romId)}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => queue([r.romId])}>
                      Send to device
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {roms.data && roms.data.unmatched.length > 0 && (
        <>
          <h3 className="mb-2 font-semibold text-stone-100">Unmatched files on the device</h3>
          <p className="mb-3 text-sm text-stone-400">
            These didn't match any server ROM by hash or name. Link them by hand so their saves line up with the right game.
          </p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {roms.data.unmatched.map((u) => (
                  <tr key={u.id} className="border-t border-stone-800 first:border-t-0">
                    <td className="px-4 py-2 font-mono text-xs">{u.localPath}</td>
                    <td className="px-4 py-2 text-stone-400">{formatBytes(u.size)}</td>
                    <td className="px-4 py-2">
                      <select
                        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm"
                        value=""
                        onChange={(e) => match(u.id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Link to server ROM…</option>
                        {roms.data!.serverRoms.map((r) => (
                          <option key={r.romId} value={r.romId}>
                            {r.fileName}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
