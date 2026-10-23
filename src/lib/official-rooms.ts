import snapshot from '../data/official-rooms.json';
import { normalizeRoomName } from './room-names';

/** The published timetable provides names only, with no physical room locations. */
export interface OfficialRoom {
  id: string;
  name: string;
  short: string;
}

export const officialRoomSource = snapshot.source;
export const officialRooms: OfficialRoom[] = [...snapshot.rooms].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));

export function searchOfficialRooms(query: string): OfficialRoom[] {
  const needle = normalizeRoomName(query);
  if (needle.length < 2) return [];
  const compact = needle.replaceAll(' ', '');
  const exact = officialRooms.filter((room) => [room.name, room.short].some((value) => normalizeRoomName(value).replaceAll(' ', '') === compact));
  if (exact.length) return exact;
  const tokens = needle.split(/\s+/);
  return officialRooms.filter((room) => [room.name, room.short].some((value) => {
    const normalized = normalizeRoomName(value);
    return tokens.every((token) => normalized.includes(token) || normalized.replaceAll(' ', '').includes(token));
  }));
}

export function findOfficialRoom(name: string): OfficialRoom | undefined {
  const needle = normalizeRoomName(name).replaceAll(' ', '');
  const matches = officialRooms.filter((room) => [room.name, room.short].some((value) => normalizeRoomName(value).replaceAll(' ', '') === needle));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Students must choose the building themselves; the timetable does not identify it. */
export function officialRoomScheduleUrl(room: OfficialRoom): string {
  return `/schedule?${new URLSearchParams({ add: '1', room: room.name })}`;
}
