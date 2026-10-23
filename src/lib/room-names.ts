import type { CampusBuilding, MappedRoom } from '../data/types';

export const normalizeRoomName = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Search abbreviations for existing amphitheatres; these never add room geometry. */
export function mappedRoomSearchNames(room: Pick<MappedRoom, 'name'>): string[] {
  const amphi = /^Amphi\s+([1-6A-D])$/i.exec(room.name);
  return amphi ? [room.name, `A-${amphi[1]}`, `A${amphi[1]}`] : [room.name];
}

/** Repeated names, such as Bib B1, cannot identify one room or its entrance. */
export function findMappedRoom(building: CampusBuilding, name: string): MappedRoom | undefined {
  const needle = normalizeRoomName(name).replaceAll(' ', '');
  if (!needle) return undefined;
  const matches = building.rooms.filter((room) => mappedRoomSearchNames(room).some((value) => normalizeRoomName(value).replaceAll(' ', '') === needle));
  return matches.length === 1 ? matches[0] : undefined;
}
