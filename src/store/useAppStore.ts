import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';
export type CameraCommand = 'reset' | 'north' | 'zoom-in' | 'zoom-out' | 'cour-rouge' | 'route' | 'position';

interface AppState {
  theme: ThemePreference;
  lowPower: boolean;
  labels: boolean;
  mapMode: '3d' | '2d';
  setTheme: (theme: ThemePreference) => void;
  setLowPower: (enabled: boolean) => void;
  setLabels: (visible: boolean) => void;
  setMapMode: (mode: '3d' | '2d') => void;
}

interface MapState {
  heading: number;
  modelProgress: number;
  cameraCommand: { type: CameraCommand; sequence: number };
  /** Native selection lives in the ephemeral store: never persisted, never in localStorage. */
  selectedBuildingId: string | null;
  searchOpen: boolean;
  setHeading: (heading: number) => void;
  setModelProgress: (progress: number) => void;
  moveCamera: (command: CameraCommand) => void;
  selectBuilding: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
}

// Camera and selection updates never enter the persistence middleware or write localStorage during a gesture.
export const useMapStore = create<MapState>((set) => ({
  heading: 0,
  modelProgress: 0,
  cameraCommand: { type: 'reset', sequence: 0 },
  selectedBuildingId: null,
  searchOpen: false,
  setHeading: (heading) => set({ heading }),
  setModelProgress: (modelProgress) => set({ modelProgress }),
  moveCamera: (type) => set((state) => ({ cameraCommand: { type, sequence: state.cameraCommand.sequence + 1 } })),
  selectBuilding: (selectedBuildingId) => set({ selectedBuildingId }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}));

export const useAppStore = create<AppState>()(persist((set) => ({
  theme: 'system',
  lowPower: false,
  labels: true,
  mapMode: '3d',
  setTheme: (theme) => set({ theme }),
  setLowPower: (lowPower) => set({ lowPower }),
  setLabels: (labels) => set({ labels }),
  setMapMode: (mapMode) => set({ mapMode }),
}), {
  name: 'fsm-navigator-preferences-v1',
  version: 1,
  storage: createJSONStorage(() => ({
    getItem: (name) => { try { return localStorage.getItem(name); } catch { return null; } },
    setItem: (name, value) => { try { localStorage.setItem(name, value); } catch { /* Preferences still work for this session. */ } },
    removeItem: (name) => { try { localStorage.removeItem(name); } catch { /* Storage can be disabled by the browser. */ } },
  })),
  partialize: ({ theme, lowPower, labels, mapMode }) => ({ theme, lowPower, labels, mapMode }),
  merge: (stored, current) => {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return current;
    const preferences = stored as Record<string, unknown>;
    return {
      ...current,
      theme: ['light', 'dark', 'system'].includes(String(preferences.theme)) ? preferences.theme as ThemePreference : current.theme,
      lowPower: typeof preferences.lowPower === 'boolean' ? preferences.lowPower : current.lowPower,
      labels: typeof preferences.labels === 'boolean' ? preferences.labels : current.labels,
      mapMode: preferences.mapMode === '2d' || preferences.mapMode === '3d' ? preferences.mapMode : current.mapMode,
    };
  },
}));
