import { useEffect, useState } from 'react';

/** Refresh on minute boundaries and immediately after a sleeping phone returns to the app. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const refresh = () => {
      window.clearTimeout(timer);
      setNow(new Date());
      timer = window.setTimeout(refresh, 60_000 - (Date.now() % 60_000) + 20);
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}
