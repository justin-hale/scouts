import { useState } from 'react';
import { get, put, type Profile, type Setting } from '../api';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, useApi } from '../components/ui';

export default function Settings() {
  const settings = useApi(() => get<Setting[]>('/settings'));
  const profiles = useApi(() => get<Profile[]>('/profiles'));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    try {
      settings.setData(await put<Setting[]>('/settings', draft));
      setDraft({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <ErrorNote error={error ?? settings.error} />

      <h2 className="mb-1 text-lg font-semibold text-stone-100">Metadata providers</h2>
      <p className="mb-3 text-sm text-stone-400">
        Box art from <b>libretro thumbnails</b> works with no setup when your ROMs use No-Intro / Redump names. For descriptions, release
        dates and better matching add{' '}
        <a className="text-ember-400 underline" href="https://api-docs.igdb.com/#account-creation" target="_blank" rel="noreferrer">
          IGDB (free Twitch app)
        </a>{' '}
        credentials, and a{' '}
        <a className="text-ember-400 underline" href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">
          SteamGridDB API key
        </a>{' '}
        for more cover art.
      </p>
      <Card className="mb-10 space-y-4 p-5">
        {settings.data?.map((s) => (
          <div key={s.key}>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-stone-400">
              {s.label} {s.set && <Badge tone="green">set</Badge>}
            </label>
            <Input
              type={s.secret ? 'password' : 'text'}
              placeholder={s.secret && s.set ? '•••••••• (unchanged)' : ''}
              value={draft[s.key] ?? (s.secret ? '' : (s.value ?? ''))}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex justify-end gap-2">
          {saved && <span className="self-center text-sm text-emerald-400">Saved</span>}
          <Button variant="primary" onClick={save} disabled={Object.keys(draft).length === 0}>
            Save
          </Button>
        </div>
      </Card>

      <h2 className="mb-1 text-lg font-semibold text-stone-100">Emulator profiles</h2>
      <p className="mb-3 text-sm text-stone-400">
        How each emulator lays out saves. Add your own by dropping a YAML file in the server's profiles folder (see
        docs/emulator-profiles.md).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {profiles.data?.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-stone-100">{p.name}</h3>
              <Badge>{p.id}</Badge>
            </div>
            {p.description && <p className="mt-2 text-sm text-stone-400">{p.description}</p>}
            <div className="mt-3 flex flex-wrap gap-1">
              {p.platforms.map((s) => (
                <Badge key={s} tone="ember">
                  {s}
                </Badge>
              ))}
            </div>
            <ul className="mt-3 space-y-1">
              {p.saves.map((r, i) => (
                <li key={i} className="font-mono text-xs break-all text-stone-500">
                  {r.pattern}
                  {r.file && <span className="text-stone-600"> → {r.file}</span>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
