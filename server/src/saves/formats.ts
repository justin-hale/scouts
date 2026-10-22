/**
 * Some emulators wrap the raw save data. Profiles name the wrapper with
 * `format:`; uploads are unwrapped so the server always stores the raw save,
 * which every other emulator can use.
 */
export const SAVE_FORMATS = ['desmume-dsv'] as const;
export type SaveFormat = (typeof SAVE_FORMATS)[number];

// DeSmuME (and DraStic) append a footer that starts with this text.
const DSV_MARKER = Buffer.from('|<--Snip above here to create a raw sav', 'latin1');

/** Device file contents -> raw save. */
export function decodeSave(format: SaveFormat | undefined, data: Buffer): Buffer {
  if (format === 'desmume-dsv') {
    const at = data.lastIndexOf(DSV_MARKER);
    return at >= 0 ? data.subarray(0, at) : data;
  }
  return data;
}

// Raw saves are written as-is: DraStic and DeSmuME both load .dsv files
// without a footer and add their own on the next save.
