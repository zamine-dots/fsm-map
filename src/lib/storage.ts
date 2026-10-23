import type { ScheduleBackup, ScheduledClass } from '../data/types';
import { isRecord, parseScheduledClasses } from './schedule';

export const SCHEDULE_STORAGE_KEY = 'fsm-navigator-schedule-v1';
export const MAX_BACKUP_BYTES = 1_048_576;
export interface ScheduleContext { campusId: string; timezone: string }
export type ScheduleStorageState = 'ready' | 'unavailable' | 'corrupt' | 'conflict';

export function parseScheduleBackup(raw: string, context: ScheduleContext): ScheduleBackup {
  if (raw.length > MAX_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('La sauvegarde dépasse la limite de 1 Mo.');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Le fichier ne contient pas un JSON lisible.'); }
  if (!isRecord(value) || value.format !== 'fsm-navigator-schedule' || value.version !== 1) {
    throw new Error('Format non reconnu. Importez une sauvegarde de planning FSM Navigator, version 1.');
  }
  if (value.campusId !== context.campusId || value.timezone !== context.timezone) {
    throw new Error('Cette sauvegarde utilise un autre campus ou fuseau horaire. Le planning actuel est conservé.');
  }
  if (typeof value.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.exportedAt) ||
    !Number.isFinite(Date.parse(value.exportedAt)) || new Date(value.exportedAt).toISOString() !== value.exportedAt) {
    throw new Error('La date de sauvegarde est invalide.');
  }
  return { format: value.format, version: value.version, ...context, exportedAt: value.exportedAt, classes: parseScheduledClasses(value.classes) };
}

export function serializeSchedule(classes: ScheduledClass[], context: ScheduleContext, now = new Date()): string {
  const backup: ScheduleBackup = { format: 'fsm-navigator-schedule', version: 1, ...context, exportedAt: now.toISOString(), classes: parseScheduledClasses(classes) };
  return JSON.stringify(backup, null, 2);
}

export interface ScheduleStorageRead {
  classes: ScheduledClass[];
  raw: string | null;
  state: 'ready' | 'unavailable' | 'corrupt';
  detail: string;
}

export function readScheduleStorage(storage: Pick<Storage, 'getItem'> | null, context: ScheduleContext): ScheduleStorageRead {
  let raw: string | null;
  try {
    if (!storage) throw new Error('Stockage indisponible');
    raw = storage.getItem(SCHEDULE_STORAGE_KEY);
  } catch {
    return { classes: [], raw: null, state: 'unavailable', detail: 'Le navigateur refuse l’accès au stockage local.' };
  }
  if (raw === null) return { classes: [], raw, state: 'ready', detail: '' };
  try {
    return { classes: parseScheduleBackup(raw, context).classes, raw, state: 'ready', detail: '' };
  } catch (error) {
    return { classes: [], raw, state: 'corrupt', detail: error instanceof Error ? error.message : 'Copie locale illisible.' };
  }
}

/** Optimistic check: do not silently overwrite a change from another tab. */
export function writeScheduleStorage(storage: Pick<Storage, 'getItem' | 'setItem'> | null, raw: string, expectedRaw: string | null, replace = false):
  { state: 'ready' | 'unavailable' | 'conflict'; raw: string | null } {
  try {
    if (!storage) return { state: 'unavailable', raw: null };
    const current = storage.getItem(SCHEDULE_STORAGE_KEY);
    if (!replace && current !== expectedRaw) return { state: 'conflict', raw: current };
    storage.setItem(SCHEDULE_STORAGE_KEY, raw);
    return { state: 'ready', raw };
  } catch {
    return { state: 'unavailable', raw: null };
  }
}

export function downloadTextFile(contents: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
