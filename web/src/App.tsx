import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { get, post } from './api';
import Conflicts from './pages/Conflicts';
import DevicePage from './pages/Device';
import Devices from './pages/Devices';
import Game from './pages/Game';
import Library from './pages/Library';
import Login from './pages/Login';
import Platforms from './pages/Platforms';
import Saves from './pages/Saves';
import Settings from './pages/Settings';

type AuthState = { setupRequired: boolean; authenticated: boolean } | null;

const NAV = [
  { to: '/library', label: 'Library', icon: '🎮' },
  { to: '/saves', label: 'Saves', icon: '💾' },
  { to: '/platforms', label: 'Platforms', icon: '🗂️' },
  { to: '/devices', label: 'Devices', icon: '📱' },
  { to: '/conflicts', label: 'Conflicts', icon: '⚠️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [auth, setAuth] = useState<AuthState>(null);
  const [conflicts, setConflicts] = useState(0);

  const refreshAuth = () => get<AuthState>('/auth/status').then(setAuth);

  useEffect(() => {
    void refreshAuth();
    const onUnauthorized = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('romsafe:unauthorized', onUnauthorized);
    return () => window.removeEventListener('romsafe:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const load = () =>
      get<{ openConflicts: number }>('/stats')
        .then((s) => setConflicts(s.openConflicts))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [auth?.authenticated]);

  if (!auth) return null;
  if (!auth.authenticated) return <Login setup={auth.setupRequired} onDone={refreshAuth} />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-stone-800 bg-stone-950 px-3 py-2 md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="mr-3 flex items-center gap-2 px-2 md:mr-0 md:mb-6">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight text-stone-50">RomSafe</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition ${
                isActive ? 'bg-stone-800 text-stone-50' : 'text-stone-400 hover:bg-stone-900 hover:text-stone-200'
              }`
            }
          >
            <span aria-hidden>{n.icon}</span>
            {n.label}
            {n.to === '/conflicts' && conflicts > 0 && (
              <span className="ml-auto rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{conflicts}</span>
            )}
          </NavLink>
        ))}
        <button
          className="mt-auto hidden rounded-md px-3 py-2 text-left text-sm text-stone-500 hover:text-stone-300 md:block"
          onClick={() => post('/auth/logout').then(refreshAuth)}
        >
          Sign out
        </button>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<Library />} />
          <Route path="/games/:id" element={<Game />} />
          <Route path="/saves" element={<Saves />} />
          <Route path="/platforms" element={<Platforms />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DevicePage />} />
          <Route path="/conflicts" element={<Conflicts onChange={setConflicts} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Routes>
      </main>
    </div>
  );
}
