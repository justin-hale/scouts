/** The RomSafe mark: a vault with a game cartridge behind its door. Same drawing as public/favicon.svg. */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="RomSafe" className={className} />;
}
