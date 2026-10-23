import { useState } from 'react';
import { faFileZipper, Icon } from './icons';
import { Button, Modal } from './ui';

const FORMATS = [
  { id: 'generic-sav', label: 'Plain .sav files', hint: 'Game.sav, which most emulators load (mGBA, melonDS, DraStic, ...).' },
  { id: 'retroarch', label: 'RetroArch', hint: 'Game.srm, ready for RetroArch\'s saves folder.' },
  { id: '', label: 'As stored on the server', hint: 'The same layout as your RomSafe save folder.' },
];

/**
 * Download the current version of every save in scope as one zip. Saves a
 * format can't place (3DS, GameCube, PSP folders) keep the server's layout.
 */
export function ExportSaves({ platform, gameId, label = 'Download as zip' }: { platform?: string; gameId?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState('generic-sav');
  const params = new URLSearchParams({
    ...(platform && { platform }),
    ...(gameId && { gameId: String(gameId) }),
    ...(format && { profile: format }),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icon icon={faFileZipper} /> {label}
      </Button>
      {open && (
        <Modal title="Download saves" onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm text-stone-400">
            {gameId ? "This game's" : platform ? "This platform's" : 'Every'} current saves, in one zip. Older versions stay on the server.
          </p>
          <div className="space-y-2">
            {FORMATS.map((f) => (
              <label
                key={f.id || 'server'}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${format === f.id ? 'border-brand-500 bg-brand-600/10' : 'border-stone-800 hover:border-stone-600'}`}
              >
                <input type="radio" name="format" className="mt-0.5 accent-teal-500" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <span>
                  <span className="font-medium text-stone-100">{f.label}</span>
                  <span className="block text-xs text-stone-500">{f.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">3DS, Wii, PSP and GameCube saves keep their folder structure whichever you pick.</p>
          <div className="mt-5 flex justify-end">
            <a
              href={`/api/saves/export.zip?${params}`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              <Icon icon={faFileZipper} /> Download zip
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}
