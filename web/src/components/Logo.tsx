/** The RomSafe mark: a vault door with its wheel. Source artwork in docs/brand/romsafe-logo.png. */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/logo.png" alt="RomSafe" className={className} />;
}
