import { create } from 'zustand';
import type { ScheduledClass } from '../data/types';
import { campusData } from '../lib/campus-catalog';
import { parseScheduledClass, parseScheduledClasses } from '../lib/schedule';
import { readScheduleStorage, serializeSchedule, writeScheduleStorage, type ScheduleStorageState } from '../lib/storage';

export const scheduleContext = { campusId: campusData.id, timezone: campusData.timezone };

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

const initial = readScheduleStorage(browserStorage(), scheduleContext);
let lastReadRaw = initial.raw;

interface ScheduleState {
  classes: ScheduledClass[];
  storageState: ScheduleStorageState;
  storageDetail: string;
  recoveryRaw: string | null;
  dirty: boolean;
  saveClass: (course: ScheduledClass) => void;
  deleteClass: (id: string) => void;
  replaceClasses: (classes: ScheduledClass[]) => void;
  retrySave: (replace?: boolean) => void;
  reloadStorage: (discardChanges?: boolean) => void;
}

export const useScheduleStore = create<ScheduleState>((set, get) => {
  function save(classes: ScheduledClass[], replace = false) {
    const validated = parseScheduledClasses(classes);
    const state = get();
    if (!replace && (state.storageState === 'corrupt' || state.storageState === 'conflict')) {
      set({ classes: validated, dirty: true });
      return;
    }
    const raw = serializeSchedule(validated, scheduleContext);
    const result = writeScheduleStorage(browserStorage(), raw, lastReadRaw, replace);
    if (result.state === 'ready') lastReadRaw = result.raw;
    set({
      classes: validated,
      dirty: result.state !== 'ready',
      storageState: result.state,
      recoveryRaw: result.state === 'ready' ? null : result.state === 'conflict' ? result.raw : state.recoveryRaw,
      storageDetail: result.state === 'unavailable' ? 'Le navigateur refuse l’écriture ou le stockage est plein.' : '',
    });
  }

  return {
    classes: initial.classes,
    storageState: initial.state,
    storageDetail: initial.detail,
    recoveryRaw: initial.state === 'corrupt' ? initial.raw : null,
    dirty: false,
    saveClass: (course) => {
      const validated = parseScheduledClass(course);
      const current = get().classes;
      save(current.some((entry) => entry.id === validated.id)
        ? current.map((entry) => entry.id === validated.id ? validated : entry)
        : [...current, validated]);
    },
    deleteClass: (id) => save(get().classes.filter((course) => course.id !== id)),
    replaceClasses: (classes) => save(classes, true),
    retrySave: (replace = false) => save(get().classes, replace),
    reloadStorage: (discardChanges = false) => {
      const loaded = readScheduleStorage(browserStorage(), scheduleContext);
      if (get().dirty && !discardChanges) {
        if (loaded.raw !== lastReadRaw) set({ storageState: 'conflict', recoveryRaw: loaded.raw });
        return;
      }
      lastReadRaw = loaded.raw;
      set({
        classes: loaded.state === 'ready' ? loaded.classes : get().classes,
        storageState: loaded.state,
        storageDetail: loaded.detail,
        recoveryRaw: loaded.state === 'corrupt' ? loaded.raw : null,
        dirty: loaded.state !== 'ready' && get().dirty,
      });
    },
  };
});
