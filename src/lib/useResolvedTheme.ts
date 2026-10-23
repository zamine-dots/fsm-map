import { useSyncExternalStore } from 'react';
import { useAppStore } from '../store/useAppStore';

const query = '(prefers-color-scheme: dark)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const getSnapshot = () => window.matchMedia(query).matches;

export function useResolvedTheme(): 'light' | 'dark' {
  const preference = useAppStore((state) => state.theme);
  const systemDark = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
