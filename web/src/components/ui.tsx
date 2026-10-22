import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) {
  const styles = {
    default: 'bg-stone-800 hover:bg-stone-700 text-stone-100 border border-stone-700',
    primary: 'bg-ember-600 hover:bg-ember-500 text-white',
    danger: 'bg-red-900/60 hover:bg-red-800 text-red-100 border border-red-800',
    ghost: 'hover:bg-stone-800 text-stone-300',
  }[variant];
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-800 bg-stone-900/60 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>;
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'ember' | 'green' | 'red' | 'sky' }) {
  const tones = {
    stone: 'bg-stone-800 text-stone-300',
    ember: 'bg-ember-600/20 text-ember-400',
    green: 'bg-emerald-900/50 text-emerald-300',
    red: 'bg-red-900/50 text-red-300',
    sky: 'bg-sky-900/50 text-sky-300',
  }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tones}`}>{children}</span>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-ember-500 focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-stone-700 bg-stone-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-3">
          <h2 className="font-semibold text-stone-100">{title}</h2>
          <button className="text-stone-400 hover:text-stone-100" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-stone-800">
      <div className="h-full bg-ember-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const formatBytes = (n: number | null | undefined) => {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

export const formatTime = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : 'never');

export const timeAgo = (ms: number | null | undefined) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
