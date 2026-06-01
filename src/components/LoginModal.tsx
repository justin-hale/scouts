import { useState } from "react";
import { Modal } from "./Modal";

export function LoginModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  /** Returns true on success. */
  onSubmit: (password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(password);
      if (!ok) setError("Incorrect password. Try again.");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Sign in to edit" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Enter the editor password to add and change events.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !password}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>
    </Modal>
  );
}
