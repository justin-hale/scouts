import { useEffect, useState } from 'react';
import { get, post, type JobStatus } from '../api';
import { Button, Progress } from './ui';

/** Start/track a background job (library scan or metadata scrape) with polling. */
export function JobButton({
  label,
  statusUrl,
  start,
  onFinished,
  variant = 'default',
}: {
  label: string;
  statusUrl: string;
  start: () => Promise<unknown>;
  onFinished?: () => void;
  variant?: 'default' | 'primary';
}) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<JobStatus>(statusUrl).then(setStatus).catch(() => {});
  }, [statusUrl]);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(async () => {
      const s = await get<JobStatus>(statusUrl).catch(() => null);
      if (!s) return;
      setStatus(s);
      if (!s.running) onFinished?.();
    }, 1000);
    return () => clearInterval(t);
  }, [status?.running, statusUrl, onFinished]);

  const run = async () => {
    setError(null);
    try {
      await start();
      setStatus(await get<JobStatus>(statusUrl));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Button variant={variant} onClick={run} disabled={status?.running}>
        {status?.running ? `${label}… ${status.processed}/${status.total}` : label}
      </Button>
      {status?.running && <Progress value={status.processed} total={status.total} />}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {!status?.running && status && status.errors.length > 0 && (
        <span className="text-xs text-amber-400" title={status.errors.join('\n')}>
          {status.errors.length} error(s) last run
        </span>
      )}
    </div>
  );
}

export const startScan = (platforms?: string[]) => post('/library/scan', { platforms });
export const startScrape = (platform?: string) => post('/metadata/scrape', { platform });
