import { Link, useSearchParams } from 'react-router-dom';
import { get, type Platform, type SaveListItem } from '../api';
import { SaveCard } from '../components/SaveCard';
import { ErrorNote, PageHeader, useApi } from '../components/ui';

/** Every save on the server, including memory cards that aren't tied to one game. */
export default function Saves() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') ?? '';
  const platforms = useApi(() => get<Platform[]>('/platforms'));
  const saves = useApi(() => get<SaveListItem[]>(`/saves${platform ? `?platform=${platform}` : ''}`), [platform]);

  const byPlatform = new Map((platforms.data ?? []).map((p) => [p.slug, p]));
  const groups = new Map<string, SaveListItem[]>();
  for (const s of saves.data ?? []) groups.set(s.platform, [...(groups.get(s.platform) ?? []), s]);

  const label = (s: SaveListItem) => {
    if (s.gameId) return <Link to={`/games/${s.gameId}`} className="hover:text-brand-400">{s.gameTitle}</Link>;
    const kind = byPlatform.get(s.platform)?.keyKind;
    if (kind !== 'card') return s.gameKey;
    // GameCube cards are keyed "<region>/<slot>".
    const [region, slot] = s.gameKey.split('/');
    return slot ? `Memory card ${slot} (${region})` : `Memory card ${s.gameKey}`;
  };

  return (
    <>
      <PageHeader
        title="Saves"
        subtitle="Every save the server holds. Memory cards (GameCube, PS2, Dreamcast) hold many games, so they live here rather than on a game page."
        actions={
          <select
            className="rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm"
            value={platform}
            onChange={(e) => setParams(e.target.value ? { platform: e.target.value } : {})}
          >
            <option value="">All platforms</option>
            {(platforms.data ?? [])
              .filter((p) => p.counts.saves > 0)
              .map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
          </select>
        }
      />
      <ErrorNote error={saves.error} />
      {saves.data?.length === 0 && <p className="text-sm text-stone-500">No saves yet.</p>}
      {[...groups].map(([slug, list]) => (
        <section key={slug} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-stone-100">{byPlatform.get(slug)?.name ?? slug}</h2>
          <div className="space-y-3">
            {list.map((s) => (
              <SaveCard key={s.id} save={s} label={label(s)} onChange={saves.reload} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
