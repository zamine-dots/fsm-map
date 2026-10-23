import type { CampusBuilding, ScheduledClass, Weekday } from '../data/types';

export const MAX_SCHEDULE_CLASSES = 250;
export const WEEKDAYS: { value: Weekday; label: string; short: string }[] = [
  { value: 1, label: 'Lundi', short: 'Lun' },
  { value: 2, label: 'Mardi', short: 'Mar' },
  { value: 3, label: 'Mercredi', short: 'Mer' },
  { value: 4, label: 'Jeudi', short: 'Jeu' },
  { value: 5, label: 'Vendredi', short: 'Ven' },
  { value: 6, label: 'Samedi', short: 'Sam' },
  { value: 7, label: 'Dimanche', short: 'Dim' },
];

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 1440;
const MILLISECONDS_PER_DAY = 86_400_000;
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown, label: string, maxLength: number, optional = false): string {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} : texte invalide ou trop long (maximum ${maxLength} caractères).`);
  }
  const trimmed = value.trim();
  if (!optional && !trimmed) throw new Error(`${label} : ce champ est obligatoire.`);
  return trimmed;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Used for form submissions, disk reads and imports; no unvalidated records reach the store. */
export function parseScheduledClass(value: unknown): ScheduledClass {
  if (!isRecord(value)) throw new Error('Le cours doit être un objet.');
  const id = readText(value.id, 'Identifiant', 160);
  const buildingId = readText(value.buildingId, 'Bâtiment', 160);
  const title = readText(value.title, 'Intitulé du cours', 160);
  const room = readText(value.room, 'Salle', 100);
  const label = readText(value.label, 'Libellé personnel', 100, true);
  const catalogCode = value.catalogCode === null ? null : readText(value.catalogCode, 'Code du catalogue', 100);
  if (!Array.isArray(value.days) || !value.days.length || value.days.length > 7 ||
    value.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(value.days).size !== value.days.length) {
    throw new Error('Choisissez au moins un jour, sans doublon (1 = lundi, 7 = dimanche).');
  }
  if (typeof value.startTime !== 'string' || !TIME_PATTERN.test(value.startTime) ||
    typeof value.endTime !== 'string' || !TIME_PATTERN.test(value.endTime)) {
    throw new Error('Renseignez le début et la fin au format HH:mm.');
  }
  if (timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)) {
    throw new Error('La fin doit être après le début, le même jour. Les séances qui passent minuit ne sont pas prises en charge.');
  }
  if (value.floor !== null && (typeof value.floor !== 'number' || !Number.isInteger(value.floor) || value.floor < -20 || value.floor > 200)) {
    throw new Error('Le niveau doit être un entier entre −20 et 200, ou rester vide si inconnu.');
  }
  return { id, buildingId, catalogCode, title, room, floor: value.floor as number | null, label,
    days: [...value.days].sort((first, second) => first - second) as Weekday[], startTime: value.startTime, endTime: value.endTime };
}

export function parseScheduledClasses(value: unknown): ScheduledClass[] {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULE_CLASSES) {
    throw new Error(`Le planning doit contenir au maximum ${MAX_SCHEDULE_CLASSES} cours récurrents.`);
  }
  const identifiers = new Set<string>();
  return value.map((entry, index) => {
    try {
      const course = parseScheduledClass(entry);
      if (identifiers.has(course.id)) throw new Error('Deux cours ont le même identifiant.');
      identifiers.add(course.id);
      return course;
    } catch (error) {
      throw new Error(`Cours ${index + 1} : ${error instanceof Error ? error.message : 'données invalides'}`);
    }
  });
}

export function createScheduleId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `course-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const scheduleTitle = (course: ScheduledClass): string => course.label || course.title;
export const scheduleDaysLabel = (days: Weekday[]): string => WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.short).join(' · ');
export const scheduleMapUrl = (course: ScheduledClass): string => `/map?${new URLSearchParams({ building: course.buildingId, class: course.id })}`;
export const scheduleEditUrl = (id: string): string => `/schedule?${new URLSearchParams({ edit: id })}`;
export const scheduleAddUrl = (buildingId?: string, code?: string): string => {
  const params = new URLSearchParams({ add: '1' });
  if (buildingId) params.set('building', buildingId);
  if (code) params.set('code', code);
  return `/schedule?${params}`;
};

export function compareClasses(first: ScheduledClass, second: ScheduledClass): number {
  return first.startTime.localeCompare(second.startTime) || first.endTime.localeCompare(second.endTime) ||
    scheduleTitle(first).localeCompare(scheduleTitle(second), 'fr') || first.id.localeCompare(second.id);
}

export function overlappingClasses(candidate: ScheduledClass, classes: ScheduledClass[]): ScheduledClass[] {
  if (!TIME_PATTERN.test(candidate.startTime) || !TIME_PATTERN.test(candidate.endTime) || candidate.startTime >= candidate.endTime) return [];
  return classes.filter((course) => course.id !== candidate.id && course.days.some((day) => candidate.days.includes(day)) &&
    timeToMinutes(candidate.startTime) < timeToMinutes(course.endTime) && timeToMinutes(candidate.endTime) > timeToMinutes(course.startTime));
}

export function conflictingIdsForDay(classes: ScheduledClass[], day: Weekday): Set<string> {
  const daily = classes.filter((course) => course.days.includes(day));
  const conflicting = new Set<string>();
  for (let index = 0; index < daily.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < daily.length; otherIndex += 1) {
      if (daily[index].startTime < daily[otherIndex].endTime && daily[index].endTime > daily[otherIndex].startTime) {
        conflicting.add(daily[index].id);
        conflicting.add(daily[otherIndex].id);
      }
    }
  }
  return conflicting;
}

export function searchCourseCatalog(buildings: CampusBuilding[], query: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return buildings.flatMap((building) => building.classes.map((course) => ({ building, course })))
    .filter(({ building, course }) => tokens.every((token) => normalize(`${building.name} ${building.shortCode} ${course.code} ${course.title} ${course.room}`).includes(token)));
}

export interface CampusClock {
  daySerial: number;
  dateKey: string;
  weekday: Weekday;
  minuteOfDay: number;
}

/** Calendar arithmetic uses UTC containers for campus wall dates, never the device's timezone. */
export function getCampusClock(now: Date, timezone: string): CampusClock {
  let formatter = clockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    clockFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const wallDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  return {
    daySerial: wallDate.getTime() / MILLISECONDS_PER_DAY,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: (((wallDate.getUTCDay() + 6) % 7) + 1) as Weekday,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export interface ClassOccurrence {
  course: ScheduledClass;
  dateKey: string;
  weekday: Weekday;
  dayOffset: number;
  startsInMinutes: number;
  endsInMinutes: number;
  current: boolean;
}

export function getScheduleOverview(classes: ScheduledClass[], now: Date, timezone: string) {
  const clock = getCampusClock(now, timezone);
  const occurrences: ClassOccurrence[] = [];
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const weekday = (((clock.weekday - 1 + dayOffset) % 7) + 1) as Weekday;
    const dateKey = new Date((clock.daySerial + dayOffset) * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
    for (const course of classes) {
      if (!course.days.includes(weekday)) continue;
      const startsInMinutes = dayOffset * MINUTES_PER_DAY + timeToMinutes(course.startTime) - clock.minuteOfDay;
      const endsInMinutes = dayOffset * MINUTES_PER_DAY + timeToMinutes(course.endTime) - clock.minuteOfDay;
      if (endsInMinutes <= 0) continue;
      occurrences.push({ course, dateKey, weekday, dayOffset, startsInMinutes, endsInMinutes, current: startsInMinutes <= 0 });
    }
  }
  occurrences.sort((first, second) => first.startsInMinutes - second.startsInMinutes || compareClasses(first.course, second.course));
  const current = occurrences.filter((occurrence) => occurrence.current);
  const next = occurrences.find((occurrence) => !occurrence.current) ?? null;
  return { clock, current, next, primary: current[0] ?? next, today: occurrences.filter((occurrence) => occurrence.dayOffset === 0) };
}

export function durationLabel(minutes: number): string {
  const rounded = Math.max(0, Math.ceil(minutes));
  const days = Math.floor(rounded / MINUTES_PER_DAY);
  const hours = Math.floor((rounded % MINUTES_PER_DAY) / 60);
  const remaining = rounded % 60;
  if (days) return `${days} j${hours ? ` ${hours} h` : ''}`;
  if (hours) return `${hours} h${remaining ? ` ${remaining.toString().padStart(2, '0')}` : ''}`;
  return `${remaining} min`;
}

export function occurrenceDayLabel(occurrence: ClassOccurrence): string {
  if (occurrence.dayOffset === 0) return 'Aujourd’hui';
  if (occurrence.dayOffset === 1) return 'Demain';
  return `${WEEKDAYS[occurrence.weekday - 1].label}${occurrence.dayOffset === 7 ? ' prochain' : ''} ${occurrence.dateKey.slice(8)}/${occurrence.dateKey.slice(5, 7)}`;
}
