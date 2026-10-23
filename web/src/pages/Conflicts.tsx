import { Link } from 'react-router-dom';
import { get, post, type Conflict } from '../api';
import { Badge, Button, Card, ErrorNote, formatBytes, formatTime, PageHeader, useApi } from '../components/ui';
import { folderLabel } from '../folders';

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
      {conflicts.data?.length === 0 && <Card className="p-6 text-sm text-stone-400">No conflicts. All saves are in sync.</Card>}
      <div className="space-y-4">
        {conflicts.data?.map((c) => {
          // Only call one copy newer when both file times are known; upload times say nothing about play time.
          const known = c.serverFileMtime != null && c.deviceFileMtime != null && c.serverFileMtime !== c.deviceFileMtime;
          return (
            <Card key={c.id} className="p-5">
              <div className="mb-4">
                {c.gameId ? (
                  <Link to={`/games/${c.gameId}`} className="font-semibold text-stone-100 hover:text-brand-400">
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
                  origin={c.serverDevice ? `Synced from ${c.serverDevice}` : (c.serverNote ?? 'Uploaded in the web app')}
                  folder={c.serverDevice ? c.serverFolder : null}
                  changedAt={c.serverFileMtime}
                  uploadedAt={c.serverCreatedAt}
                  size={c.serverSize}
                  newer={known && c.serverFileMtime! > c.deviceFileMtime!}
                  versionId={c.serverVersionId}
                  onKeep={() => resolve(c.id, 'server')}
                />
                <Side
                  title={`Copy from ${c.device ?? 'device'}`}
                  origin={c.deviceFolder ? 'From the emulator folder' : null}
                  folder={c.deviceFolder}
                  changedAt={c.deviceFileMtime}
                  uploadedAt={c.deviceCreatedAt}
                  size={c.deviceSize}
                  newer={known && c.deviceFileMtime! > c.serverFileMtime!}
                  versionId={c.deviceVersionId}
                  onKeep={() => resolve(c.id, 'device')}
                />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Side(props: {
  title: string;
  origin: string | null;
  folder: string | null;
  changedAt: number | null;
  uploadedAt: number;
  size: number;
  newer: boolean;
  versionId: number;
  onKeep: () => void;
}) {
  return (
    <div className={`rounded-lg border bg-stone-950/50 p-4 ${props.newer ? 'border-brand-600/60' : 'border-stone-800'}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-stone-200">{props.title}</span>
        {props.newer && <Badge tone="brand">Newer</Badge>}
      </div>
      {props.origin && (
        <div className="mt-1 text-xs text-stone-400">
          {props.origin}
          {props.folder && (
            <>
              {': '}
              <span className="font-mono break-all text-stone-300" title={props.folder}>
                {folderLabel(props.folder)}
              </span>
            </>
          )}
        </div>
      )}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-stone-500">File last changed</dt>
        <dd className={props.newer ? 'text-brand-400' : 'text-stone-300'}>{props.changedAt ? formatTime(props.changedAt) : 'unknown'}</dd>
        <dt className="text-stone-500">Reached the server</dt>
        <dd className="text-stone-400">{formatTime(props.uploadedAt)}</dd>
        <dt className="text-stone-500">Size</dt>
        <dd className="text-stone-400">{formatBytes(props.size)}</dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={props.onKeep}>
          Keep this one
        </Button>
        <a className="self-center text-xs text-brand-400 hover:underline" href={`/api/save-versions/${props.versionId}/download`}>
          download
        </a>
      </div>
    </div>
  );
}
