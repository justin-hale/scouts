import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, type Device } from '../api';
import { Badge, Button, Card, ErrorNote, Modal, PageHeader, timeAgo, useApi } from '../components/ui';

export default function Devices() {
  const devices = useApi(() => get<Device[]>('/devices'));
  const [pairing, setPairing] = useState(false);

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Phones, handhelds and PCs running the RomSafe app. Each one chooses where its emulators keep saves."
        actions={
          <Button variant="primary" onClick={() => setPairing(true)}>
            Pair a device
          </Button>
        }
      />
      <ErrorNote error={devices.error} />
      {devices.data?.length === 0 && (
        <Card className="p-6 text-sm text-stone-400">No devices yet. Install the RomSafe app on Android or Windows and pair it with a code.</Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.data?.map((d) => (
          <Link key={d.id} to={`/devices/${d.id}`}>
            <Card className="p-5 transition hover:border-stone-600">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-stone-100">{d.name}</h2>
                <Badge tone="sky">{d.kind}</Badge>
              </div>
              <div className="mt-3 text-sm text-stone-400">
                {d.mappings} platform{d.mappings === 1 ? '' : 's'} mapped
                {d.queued > 0 && ` · ${d.queued} ROM download${d.queued === 1 ? '' : 's'} queued`}
              </div>
              <div className="mt-1 text-xs text-stone-500">Last seen {timeAgo(d.lastSeenAt)}</div>
            </Card>
          </Link>
        ))}
      </div>
      {pairing && (
        <PairModal
          onClose={() => {
            setPairing(false);
            void devices.reload();
          }}
        />
      )}
    </>
  );
}

function PairModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post<{ code: string; expiresAt: number }>('/devices/pairing-code')
      .then(setCode)
      .catch((e) => setError(e.message));
  }, []);
  const server = window.location.origin;
  return (
    <Modal title="Pair a device" onClose={onClose}>
      <ErrorNote error={error} />
      <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-300">
        <li>Open the RomSafe app on your device.</li>
        <li>
          Enter this server's address: <code className="rounded bg-stone-800 px-1.5 py-0.5">{server}</code>
        </li>
        <li>Enter the pairing code:</li>
      </ol>
      {code && (
        <div className="my-5 text-center">
          <div className="font-mono text-4xl font-bold tracking-[0.3em] text-brand-400">{code.code}</div>
          <div className="mt-2 text-xs text-stone-500">Expires at {new Date(code.expiresAt).toLocaleTimeString()}</div>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
