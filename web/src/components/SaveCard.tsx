import { useState, type ReactNode } from 'react';
import { get, post, type SaveSummary, type SaveVersion } from '../api';
import { faClockRotateLeft, faDownload, Icon } from './icons';
import { Badge, Button, Card, formatBytes, formatTime, useApi } from './ui';

export function SaveCard({ save, label, onChange }: { save: SaveSummary; label?: ReactNode; onChange: () => void }) {
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
          {label && <div className="mb-0.5 text-sm font-medium text-stone-100">{label}</div>}
          <div className="font-mono text-sm text-stone-300">{save.file}</div>
          <div className="mt-1 text-xs text-stone-500">
            {formatBytes(save.size)} · updated {formatTime(save.updatedAt)} {save.updatedBy && `by ${save.updatedBy}`} · {save.versionCount}{' '}
            version{save.versionCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex gap-2">
          {save.currentVersionId && (
            <a
              href={`/api/save-versions/${save.currentVersionId}/download`}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100 hover:bg-stone-700"
            >
              <Icon icon={faDownload} /> Download
            </a>
          )}
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            <Icon icon={faClockRotateLeft} /> {open ? 'Hide history' : 'History'}
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
                  <a className="ml-2 text-xs text-brand-400 hover:underline" href={`/api/save-versions/${v.id}/download`}>
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
