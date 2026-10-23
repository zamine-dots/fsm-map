import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScheduledClass } from '../src/data/types';
import {
  conflictingIdsForDay, getCampusClock, getScheduleOverview, MAX_SCHEDULE_CLASSES,
  overlappingClasses, parseScheduledClass, parseScheduledClasses,
} from '../src/lib/schedule';
import {
  MAX_BACKUP_BYTES, parseScheduleBackup, readScheduleStorage, SCHEDULE_STORAGE_KEY,
  serializeSchedule, writeScheduleStorage,
} from '../src/lib/storage';

const context = { campusId: 'fsm-campus', timezone: 'Africa/Tunis' };
const course: ScheduledClass = {
  id: 'test-course', buildingId: 'way/1203834931', catalogCode: null,
  title: 'Cours de test', room: 'Amphi 1', floor: null, label: '',
  days: [1, 3], startTime: '09:00', endTime: '10:30',
};
const at = (iso: string, classes = [course]) => getScheduleOverview(classes, new Date(iso), context.timezone);
const backup = serializeSchedule([course], context, new Date('2026-10-05T08:00:00.000Z'));

test('course validation preserves unknown floors and building IDs, and normalizes text and weekdays', () => {
  const parsed = parseScheduledClass({ ...course, title: '  Analyse  ', days: [3, 1], buildingId: 'former-building' });
  assert.equal(parsed.title, 'Analyse');
  assert.deepEqual(parsed.days, [1, 3]);
  assert.equal(parsed.floor, null);
  assert.equal(parsed.buildingId, 'former-building');
  assert.equal(parseScheduledClass({ ...course, floor: 0 }).floor, 0);
  assert.equal(parseScheduledClass({ ...course, floor: -2 }).floor, -2);
  assert.deepEqual(course.days, [1, 3], 'validation must not mutate its input');
});

test('invalid times, missing fields, duplicate days and invalid floors cannot enter a schedule', () => {
  const invalid: unknown[] = [
    null, [], { ...course, id: '' }, { ...course, title: '  ' }, { ...course, room: '' },
    { ...course, title: 'x'.repeat(161) }, { ...course, label: '\u0000' },
    { ...course, days: [] }, { ...course, days: [1, 1] }, { ...course, days: [0] },
    { ...course, days: [8] }, { ...course, days: ['1'] }, { ...course, days: [1.5] },
    { ...course, startTime: '9:00' }, { ...course, startTime: '09:60' },
    { ...course, endTime: '24:00' }, { ...course, endTime: '09:00' },
    { ...course, startTime: '23:00', endTime: '01:00' },
    { ...course, floor: '0' }, { ...course, floor: 1.5 }, { ...course, floor: 201 },
    { ...course, floor: undefined }, { ...course, catalogCode: '' },
  ];
  for (const value of invalid) assert.throws(() => parseScheduledClass(value), JSON.stringify(value));
});

test('schedule limits and unique IDs are enforced for the entire import', () => {
  assert.throws(() => parseScheduledClasses([course, course]), /identifiant/);
  const maximum = Array.from({ length: MAX_SCHEDULE_CLASSES }, (_, index) => ({ ...course, id: `test-${index}` }));
  assert.equal(parseScheduledClasses(maximum).length, MAX_SCHEDULE_CLASSES);
  assert.throws(() => parseScheduledClasses([...maximum, { ...course, id: 'extra' }]), /maximum/);
  assert.deepEqual(parseScheduledClasses([]), []);
});

test('campus dates and weekdays follow Monastir across midnight and year boundaries', () => {
  const clock = getCampusClock(new Date('2026-12-31T23:00:00Z'), context.timezone);
  assert.equal(clock.dateKey, '2027-01-01');
  assert.equal(clock.weekday, 5);
  assert.equal(clock.minuteOfDay, 0);
  assert.equal(getCampusClock(new Date('2026-10-04T23:00:00Z'), context.timezone).weekday, 1);
});

test('a session starts inclusively and ends exclusively, including overlapping current classes', () => {
  assert.equal(at('2026-10-05T07:59:00Z').primary?.startsInMinutes, 1);
  assert.equal(at('2026-10-05T07:59:00Z').current.length, 0);
  assert.equal(at('2026-10-05T08:00:00Z').primary?.current, true);
  assert.equal(at('2026-10-05T09:29:59Z').primary?.endsInMinutes, 1);
  assert.equal(at('2026-10-05T09:30:00Z').current.length, 0);
  const simultaneous = { ...course, id: 'other-course', startTime: '10:00', endTime: '11:00' };
  const overlap = at('2026-10-05T09:15:00Z', [course, simultaneous]);
  assert.deepEqual(overlap.current.map((entry) => entry.course.id), [course.id, simultaneous.id]);
  assert.equal(overlap.today.length, 2);
  assert.equal(at('2026-10-05T09:30:00Z', [course, simultaneous]).primary?.course.id, simultaneous.id);
});

test('next-class lookup includes the same weekday next week and Sunday rollover', () => {
  const monday: ScheduledClass = { ...course, days: [1] };
  const nextWeek = at('2026-10-05T10:00:00Z', [monday]);
  assert.equal(nextWeek.primary?.dayOffset, 7);
  assert.equal(nextWeek.primary?.dateKey, '2026-10-12');
  assert.equal(nextWeek.primary?.startsInMinutes, 9960);
  const sunday = at('2026-10-04T22:59:00Z', [monday]);
  assert.equal(sunday.primary?.dayOffset, 1);
  assert.equal(sunday.primary?.startsInMinutes, 541);
  assert.equal(sunday.primary?.dateKey, '2026-10-05');
  assert.equal(at('2026-10-05T08:00:00Z', []).primary, null);
});

test('overlaps exclude adjacent sessions, different weekdays and the edited class itself', () => {
  const overlapping: ScheduledClass = { ...course, id: 'overlap', days: [3], startTime: '10:00' };
  const adjacent = { ...course, id: 'adjacent', startTime: '10:30', endTime: '11:30' };
  const otherDay: ScheduledClass = { ...course, id: 'tuesday', days: [2] };
  const classes = [course, overlapping, adjacent, otherDay];
  assert.deepEqual(overlappingClasses(course, classes).map((entry) => entry.id), ['overlap']);
  assert.deepEqual([...conflictingIdsForDay(classes, 1)], []);
  assert.deepEqual([...conflictingIdsForDay(classes, 3)].sort(), ['overlap', course.id].sort());
});

test('a backup round-trips exactly and rejects incompatible or malformed envelopes', () => {
  assert.deepEqual(parseScheduleBackup(backup, context).classes, [course]);
  const envelope = JSON.parse(backup);
  for (const value of [
    null, {}, { ...envelope, format: 'campus' }, { ...envelope, version: 2 },
    { ...envelope, campusId: 'another-campus' }, { ...envelope, timezone: 'UTC' },
    { ...envelope, exportedAt: '2026-02-30T08:00:00.000Z' },
    { ...envelope, exportedAt: '2026-10-05' }, { ...envelope, classes: [course, course] },
  ]) assert.throws(() => parseScheduleBackup(JSON.stringify(value), context));
  assert.throws(() => parseScheduleBackup('{', context), /JSON/);
});

test('the backup size limit counts UTF-8 bytes as well as characters', () => {
  const oversized = 'é'.repeat(MAX_BACKUP_BYTES / 2 + 1);
  assert(oversized.length < MAX_BACKUP_BYTES);
  assert.throws(() => parseScheduleBackup(oversized, context), /1 Mo/);
  assert.throws(() => parseScheduleBackup(' '.repeat(MAX_BACKUP_BYTES + 1), context), /1 Mo/);
});

test('storage reads preserve corrupt originals and distinguish denied access from an empty schedule', () => {
  assert.equal(readScheduleStorage({ getItem: () => null }, context).state, 'ready');
  assert.deepEqual(readScheduleStorage({ getItem: () => backup }, context).classes, [course]);
  const corrupt = readScheduleStorage({ getItem: () => '{original broken data' }, context);
  assert.equal(corrupt.state, 'corrupt');
  assert.equal(corrupt.raw, '{original broken data');
  assert.equal(readScheduleStorage(null, context).state, 'unavailable');
  assert.equal(readScheduleStorage({ getItem: () => { throw new Error('denied'); } }, context).state, 'unavailable');
});

test('optimistic saves protect another tab’s changes until replacement is explicit', () => {
  const entries = new Map([[SCHEDULE_STORAGE_KEY, backup], ['preferences', 'keep']]);
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
  const changed = serializeSchedule([{ ...course, label: 'Updated' }], context);
  assert.equal(writeScheduleStorage(storage, changed, null).state, 'conflict');
  assert.equal(entries.get(SCHEDULE_STORAGE_KEY), backup);
  assert.equal(writeScheduleStorage(storage, changed, backup).state, 'ready');
  assert.equal(writeScheduleStorage(storage, backup, null, true).state, 'ready');
  assert.equal(entries.get('preferences'), 'keep');
});

test('denied and quota-limited writes report failure without altering the saved copy', () => {
  let stored = backup;
  const result = writeScheduleStorage({
    getItem: () => stored,
    setItem: () => { throw new Error('quota exceeded'); },
  }, 'new copy', backup);
  assert.equal(result.state, 'unavailable');
  assert.equal(stored, backup);
  assert.equal(writeScheduleStorage(null, backup, null).state, 'unavailable');
  stored = 'different copy';
  assert.equal(writeScheduleStorage({ getItem: () => stored, setItem: () => {} }, backup, null).state, 'conflict');
});

class MemoryStorage {
  entries = new Map<string, string>();
  denyReads = false;
  denyWrites = false;
  getItem(key: string) {
    if (this.denyReads) throw new Error('Storage access denied');
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.denyWrites) throw new Error('Storage quota exceeded');
    this.entries.set(key, value);
  }
}

type ScheduleStore = (typeof import('../src/store/useScheduleStore'))['useScheduleStore'];
let storeCase = 0;
async function withStore(storage: MemoryStorage, run: (store: ScheduleStore) => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try {
    // Each import gets the same initialization path as a fresh browser tab and its own storage baseline.
    const source = new URL('../src/store/useScheduleStore.ts', import.meta.url);
    source.searchParams.set('test', String(storeCase++));
    const { useScheduleStore } = await import(source.href) as typeof import('../src/store/useScheduleStore');
    run(useScheduleStore);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('the store persists CRUD while preserving unrelated storage keys', async () => {
  const storage = new MemoryStorage();
  storage.entries.set('fsm-building-edits-v1', '{legacy}');
  await withStore(storage, (store) => {
    assert.equal(store.getState().storageState, 'ready');
    store.getState().saveClass(course);
    store.getState().saveClass({ ...course, label: 'Edited' });
    assert.equal(store.getState().classes.length, 1);
    assert.equal(store.getState().dirty, false);
    assert.equal(parseScheduleBackup(storage.getItem(SCHEDULE_STORAGE_KEY)!, context).classes[0].label, 'Edited');
    assert.throws(() => store.getState().saveClass({ ...course, endTime: '00:00' }));
    assert.equal(store.getState().classes[0].label, 'Edited');
    store.getState().deleteClass(course.id);
    assert.deepEqual(parseScheduleBackup(storage.getItem(SCHEDULE_STORAGE_KEY)!, context).classes, []);
    assert.equal(storage.getItem('fsm-building-edits-v1'), '{legacy}');
  });
});

test('the store keeps corrupt raw data until an explicit replacement', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, '{corrupt original');
  await withStore(storage, (store) => {
    assert.equal(store.getState().storageState, 'corrupt');
    store.getState().saveClass(course);
    store.getState().retrySave();
    assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), '{corrupt original');
    assert.equal(store.getState().recoveryRaw, '{corrupt original');
    assert.equal(store.getState().dirty, true);
    assert.deepEqual(store.getState().classes, [course]);
    store.getState().retrySave(true);
    assert.equal(store.getState().storageState, 'ready');
    assert.equal(store.getState().recoveryRaw, null);
    assert.equal(store.getState().dirty, false);
    assert.deepEqual(parseScheduleBackup(storage.getItem(SCHEDULE_STORAGE_KEY)!, context).classes, [course]);
  });
});

test('the store keeps edits in memory after quota failure and retries without losing them', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, backup);
  await withStore(storage, (store) => {
    storage.denyWrites = true;
    store.getState().saveClass({ ...course, label: 'Unsaved edit' });
    assert.equal(store.getState().storageState, 'unavailable');
    assert.equal(store.getState().dirty, true);
    assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), backup);
    storage.denyWrites = false;
    store.getState().retrySave();
    assert.equal(store.getState().storageState, 'ready');
    assert.equal(store.getState().classes[0].label, 'Unsaved edit');
    assert.equal(parseScheduleBackup(storage.getItem(SCHEDULE_STORAGE_KEY)!, context).classes[0].label, 'Unsaved edit');
  });
});

test('restoring denied storage access does not overwrite an unseen saved schedule', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, backup);
  storage.denyReads = true;
  await withStore(storage, (store) => {
    assert.equal(store.getState().storageState, 'unavailable');
    assert.deepEqual(store.getState().classes, []);
    store.getState().saveClass({ ...course, id: 'new-in-memory' });
    storage.denyReads = false;
    store.getState().retrySave();
    assert.equal(store.getState().storageState, 'conflict');
    assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), backup);
    assert.equal(store.getState().classes[0].id, 'new-in-memory');
    store.getState().reloadStorage(true);
    assert.equal(store.getState().storageState, 'ready');
    assert.deepEqual(store.getState().classes, [course]);
  });
});

test('clean tabs adopt saved changes but unsaved edits survive a cross-tab conflict', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, backup);
  await withStore(storage, (store) => {
    storage.setItem(SCHEDULE_STORAGE_KEY, serializeSchedule([{ ...course, label: 'Another tab' }], context));
    store.getState().reloadStorage();
    assert.equal(store.getState().classes[0].label, 'Another tab');
    storage.denyWrites = true;
    store.getState().saveClass({ ...course, label: 'In-memory edit' });
    storage.denyWrites = false;
    const external = serializeSchedule([{ ...course, label: 'Newest other-tab edit' }], context);
    storage.setItem(SCHEDULE_STORAGE_KEY, external);
    store.getState().reloadStorage();
    assert.equal(store.getState().storageState, 'conflict');
    assert.equal(store.getState().classes[0].label, 'In-memory edit');
    assert.equal(store.getState().recoveryRaw, external);
    store.getState().retrySave();
    assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), external);
    store.getState().reloadStorage(true);
    assert.equal(store.getState().classes[0].label, 'Newest other-tab edit');
    assert.equal(store.getState().dirty, false);
  });
});

test('a missed storage event is detected before saving, and explicit replacement keeps current edits', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, backup);
  await withStore(storage, (store) => {
    const external = serializeSchedule([{ ...course, label: 'Concurrent edit' }], context);
    storage.setItem(SCHEDULE_STORAGE_KEY, external);
    store.getState().saveClass({ ...course, label: 'My edit' });
    assert.equal(store.getState().storageState, 'conflict');
    assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), external);
    store.getState().retrySave(true);
    assert.equal(store.getState().storageState, 'ready');
    assert.equal(parseScheduleBackup(storage.getItem(SCHEDULE_STORAGE_KEY)!, context).classes[0].label, 'My edit');
  });
});

test('requesting a reload cannot discard unsaved work in favor of an unreadable copy', async () => {
  const storage = new MemoryStorage();
  storage.entries.set(SCHEDULE_STORAGE_KEY, backup);
  await withStore(storage, (store) => {
    storage.denyWrites = true;
    store.getState().saveClass({ ...course, label: 'Keep this work' });
    storage.denyWrites = false;
    storage.setItem(SCHEDULE_STORAGE_KEY, '{broken replacement');
    store.getState().reloadStorage(true);
    assert.equal(store.getState().storageState, 'corrupt');
    assert.equal(store.getState().classes[0].label, 'Keep this work');
    assert.equal(store.getState().dirty, true);
    assert.equal(store.getState().recoveryRaw, '{broken replacement');
  });
});
