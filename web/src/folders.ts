/**
 * Android reports SAF tree URIs (content://…/tree/primary%3ARetroArch%2Fsaves).
 * Show them the way the app does: "Internal storage/RetroArch/saves".
 */
export function folderLabel(root: string | null | undefined): string {
  if (!root) return '—';
  const m = /^content:\/\/([^/]+)\/tree\/([^/]+)/.exec(root);
  if (!m) return root;
  const [, authority, encoded] = m;
  const docId = decodeURIComponent(encoded!);
  if (authority === 'com.android.externalstorage.documents') {
    const [volume, ...rest] = docId.split(':');
    const path = rest.join(':');
    const base = volume === 'primary' ? 'Internal storage' : 'SD card';
    return path ? `${base}/${path}` : base;
  }
  return `${authority}: ${docId}`;
}
