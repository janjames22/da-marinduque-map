// The map alone on the whole screen: the browser's own full screen where it has one, or else, as on an
// iPhone, the map filling the window over the page. Esc leaves either way, as does leaving the page.
import { useCallback, useEffect, useState, type RefObject } from 'react';

export type FullscreenMode = 'screen' | 'window';

export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<FullscreenMode | null>(null);

  // The browser leaves full screen by itself on Esc, or when the page is left.
  useEffect(() => {
    const changed = () => setMode((current) => (document.fullscreenElement === target.current && target.current ? 'screen' : current === 'screen' ? null : current));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [target]);

  useEffect(() => {
    if (mode !== 'window') return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode(null);
    };
    document.addEventListener('keydown', leave);
    return () => document.removeEventListener('keydown', leave);
  }, [mode]);

  const exit = useCallback(() => {
    if (document.fullscreenElement && document.fullscreenElement === target.current) void document.exitFullscreen?.().catch(() => {});
    setMode(null);
  }, [target]);

  const enter = useCallback(async () => {
    const element = target.current;
    if (!element) return;
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try {
        await element.requestFullscreen();
        setMode('screen');
        return;
      } catch {
        // Refused, such as inside a frame that doesn't allow it. The window will do.
      }
    }
    setMode('window');
  }, [target]);

  const toggle = useCallback(() => (mode ? exit() : void enter()), [mode, enter, exit]);

  return { mode, toggle, exit };
}
