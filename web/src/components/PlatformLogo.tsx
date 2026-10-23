import { useState } from 'react';

// Most logos are drawn solid white so they read on any cover. These rely on
// filled shapes (a badge, a box behind the text) that turn into a white blob,
// so they keep their own colours. Stacked, square or thin-lettered logos get more height.
const STYLE: Record<string, { color?: boolean; tall?: boolean }> = {
  nes: { color: true, tall: true },
  gba: { color: true },
  genesis: { color: true },
  gbc: { tall: true },
  dreamcast: { tall: true },
  ps2: { tall: true },
  psp: { tall: true },
};

/**
 * A platform's logo from public/platforms/<slug>.svg (see CREDITS.md there).
 * Falls back to the platform's name when there's no logo for it.
 */
export function PlatformLogo({ slug, name, className = '' }: { slug: string; name: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className={`text-xs font-semibold text-white ${className}`}>{name}</span>;
  const style = STYLE[slug] ?? {};
  return (
    <img
      src={`/platforms/${slug}.svg`}
      alt={name}
      title={name}
      onError={() => setMissing(true)}
      className={`object-contain object-left ${style.tall ? 'h-7' : 'h-5'} ${style.color ? 'drop-shadow' : 'brightness-0 invert'} ${className}`}
    />
  );
}
