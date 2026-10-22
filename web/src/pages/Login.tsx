import { useState, type FormEvent } from 'react';
import { post } from '../api';
import { Button, Card, ErrorNote, Input } from '../components/ui';

export default function Login({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await post(setup ? '/auth/setup' : '/auth/login', { password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="h-12 w-12" />
          <h1 className="text-xl font-semibold text-stone-50">Bonfire</h1>
          <p className="text-sm text-stone-400">
            {setup ? 'Welcome! Choose an admin password to finish setting up your server.' : 'Sign in to your server.'}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <ErrorNote error={error} />
          <Input type="password" placeholder="Password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          {setup && <Input type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          <Button variant="primary" className="w-full justify-center" disabled={busy || !password}>
            {setup ? 'Create password' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
