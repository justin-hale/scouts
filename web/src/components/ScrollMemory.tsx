import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const STORE = 'romsafe.scroll';

const load = (): Record<string, number> => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
};

/**
 * The page scrolls inside <main>, not the window, so the browser can't restore it.
 * This remembers each history entry's position and puts it back on back/forward;
 * new pages start at the top. Pages load their data after mounting, so the restore
 * waits (briefly) for the content to grow tall enough, and gives up once you scroll.
 */
export function ScrollMemory({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navType = useNavigationType();
  const positions = useRef(load());
  // Set during the commit, so a scroll event that lands after a navigation is
  // never recorded against the page we just left.
  const currentKey = useRef(location.key);

  // Record the position as you scroll, keyed by history entry.
  useEffect(() => {
    const el = ref.current!;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      positions.current[currentKey.current] = el.scrollTop;
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          sessionStorage.setItem(STORE, JSON.stringify(positions.current));
        } catch {
          // only remembered in memory
        }
      }, 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, []);

  useLayoutEffect(() => {
    currentKey.current = location.key;
    const el = ref.current!;
    const target = navType === 'POP' ? positions.current[location.key] : undefined;
    if (!target) {
      el.scrollTop = 0;
      return;
    }
    let done = false;
    const stop = () => {
      done = true;
      observer.disconnect();
      clearTimeout(timeout);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('keydown', stop);
    };
    const tryRestore = () => {
      if (done) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) stop();
    };
    const observer = new ResizeObserver(tryRestore);
    observer.observe(content.current!);
    const timeout = setTimeout(stop, 4000);
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('keydown', stop);
    tryRestore();
    return stop;
  }, [location.key, navType]);

  return (
    <main ref={ref} className={className}>
      <div ref={content}>{children}</div>
    </main>
  );
}
