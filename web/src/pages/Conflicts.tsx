import { Link } from 'react-router-dom';
import { get, post, type Conflict } from '../api';
import { Button, Card, ErrorNote, formatBytes, formatTime, PageHeader, useApi } from '../components/ui';

export default function Conflicts({ onChange }: { onChange: (n: number) => void }) {
  const conflicts = useApi(async () => {
    const list = await get<Conflict[]>('/conflicts');
    onChange(list.length);
    return list;
  });

  const resolve = async (id: number, keep: 'server' | 'device') => {
    await post(`/conflicts/${id}/resolve`, { keep });
    void conflicts.reload();
  };

  return (
    <>
      <PageHeader
        title="Conflicts"
        subtitle="A save changed on a device and on the server since they last synced. Both copies are kept; pick which one becomes current. The other stays in the save's history."
      />
      <ErrorNote error={conflicts.error} />
      {conflicts.data?.length === 0 && <Card className="p-6 text-sm text-stone-400">No conflicts. All saves are in sync. 🔥</Card>}
      <div className="space-y-4">
        {conflicts.data?.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="mb-4">
              {c.gameId ? (
                <Link to={`/games/${c.gameId}`} className="font-semibold text-stone-100 hover:text-ember-400">
                  {c.gameTitle}
                </Link>
              ) : (
                <span className="font-semibold text-stone-100">{c.gameKey}</span>
              )}
              <span className="ml-2 font-mono text-xs text-stone-500">
                {c.platform} · {c.file}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Side
                title="Server copy"
                size={c.serverSize}
                time={c.serverCreatedAt}
                versionId={c.serverVersionId}
                onKeep={() => resolve(c.id, 'server')}
              />
              <Side
                title={`Copy from ${c.device ?? 'device'}`}
                size={c.deviceSize}
                time={c.deviceCreatedAt}
                versionId={c.deviceVersionId}
                onKeep={() => resolve(c.id, 'device')}
              />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Side(props: { title: string; size: number; time: number; versionId: number; onKeep: () => void }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/50 p-4">
      <div className="text-sm font-medium text-stone-200">{props.title}</div>
      <div className="mt-1 text-xs text-stone-500">
        {formatBytes(props.size)} · {formatTime(props.time)}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={props.onKeep}>
          Keep this one
        </Button>
        <a className="self-center text-xs text-ember-400 hover:underline" href={`/api/save-versions/${props.versionId}/download`}>
          download
        </a>
      </div>
    </div>
  );
}
