/** The RomSafe mark: a vault door. Source artwork in docs/brand/romsafe-logo.webp. */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/logo.png" alt="RomSafe" className={`rounded-[22%] ${className}`} />;
}
