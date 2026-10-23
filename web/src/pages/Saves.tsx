import { Link, useSearchParams } from 'react-router-dom';
import { get, type Platform, type SaveListItem } from '../api';
import { faBoxArchive, Icon } from '../components/icons';
import { SaveCard } from '../components/SaveCard';
import { Badge, Button, ErrorNote, PageHeader, useApi } from '../components/ui';

/** Every save on the server, including memory cards that aren't tied to one game. */
export default function Saves() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') ?? '';
  const unmatchedOnly = params.get('unmatched') === '1';
  const platforms = useApi(() => get<Platform[]>('/platforms'));
  const saves = useApi(() => get<SaveListItem[]>(`/saves${platform ? `?platform=${platform}` : ''}`), [platform]);

  const byPlatform = new Map((platforms.data ?? []).map((p) => [p.slug, p]));
  // Card saves that can't belong to one game (raw cards, PS2/Dreamcast cards) aren't "unmatched".
  const isUnmatched = (s: SaveListItem) => !s.gameId && (byPlatform.get(s.platform)?.keyKind !== 'card' || !!s.label);
  const unmatchedCount = (saves.data ?? []).filter(isUnmatched).length;
  const groups = new Map<string, SaveListItem[]>();
  for (const s of saves.data ?? []) {
    if (unmatchedOnly && !isUnmatched(s)) continue;
    groups.set(s.platform, [...(groups.get(s.platform) ?? []), s]);
  }

  const setFilter = (next: { platform?: string; unmatched?: boolean }) => {
    const p = next.platform ?? platform;
    const u = next.unmatched ?? unmatchedOnly;
    setParams({ ...(p && { platform: p }), ...(u && { unmatched: '1' }) });
  };

  const label = (s: SaveListItem) => {
    if (s.gameId) return <Link to={`/games/${s.gameId}`} className="hover:text-brand-400">{s.gameTitle}</Link>;
    const unmatched = isUnmatched(s) && <Badge tone="red">no game in library</Badge>;
    if (s.label)
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          {s.label} {unmatched}
        </span>
      );
    const kind = byPlatform.get(s.platform)?.keyKind;
    if (kind !== 'card')
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          {s.gameKey} {unmatched}
        </span>
      );
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
          <>
            <Button variant={unmatchedOnly ? 'primary' : 'default'} onClick={() => setFilter({ unmatched: !unmatchedOnly })}>
              <Icon icon={faBoxArchive} /> Unmatched ({unmatchedCount})
            </Button>
            <select
              className="rounded-md border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm"
              value={platform}
              onChange={(e) => setFilter({ platform: e.target.value })}
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
          </>
        }
      />
      <ErrorNote error={saves.error} />
      {saves.data?.length === 0 && <p className="text-sm text-stone-500">No saves yet.</p>}
      {unmatchedOnly && (
        <p className="mb-6 text-sm text-stone-400">
          Saves whose game isn't in your library: the ROM is missing, zipped in a format RomSafe can't read, or named differently.
          They're still backed up and synced. Add the ROM (or set its title ID on the game page) and they link up on the next scan.
        </p>
      )}
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
