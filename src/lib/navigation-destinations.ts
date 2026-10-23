import type { BuildingSide, ScheduledClass } from '../data/types';
import { campusBuildings, findBuilding, floorLabel, floorsLabel } from './campus-catalog';
import type { BuildingTag } from './building-tags';
import { findMappedRoom, mappedRoomSearchNames, normalizeRoomName } from './room-names';
import { publishedRoomTags } from './published-room-locations';

export interface NavigationDestination {
  id: string;
  kind: 'building' | 'room' | 'course' | 'tag';
  buildingId: string;
  title: string;
  detail: string;
  search: string[];
  roomId?: string;
  roomName?: string;
  entranceId?: string;
  side?: BuildingSide;
  floors: number[];
  courseId?: string;
  tag?: BuildingTag;
}

export const normalizeDestination = normalizeRoomName;

export function exactDestinationMatch(query: string, entry: NavigationDestination): boolean {
  const compact = normalizeDestination(query).replaceAll(' ', '');
  return !!compact && [entry.title, ...entry.search].some((field) => normalizeDestination(field).replaceAll(' ', '') === compact);
}

export function navigationDestinations(classes: ScheduledClass[] = [], tags: BuildingTag[] = [], published: BuildingTag[] = publishedRoomTags): NavigationDestination[] {
  const result: NavigationDestination[] = [];
  const sharedRooms = published.map((room) => tags.find((tag) => tag.id === room.id) ?? room);
  const sharedIds = new Set(sharedRooms.map((room) => room.id));
  const represented = new Set<string>();
  const roomFloors = (floor: number | null, shared?: BuildingTag): number[] => {
    const known = floor ?? shared?.floor;
    return known === null || known === undefined ? [] : [known];
  };
  const sharedForName = (buildingId: string, name: string, floor?: number | null) => {
    const building = findBuilding(buildingId);
    const mapped = building && findMappedRoom(building, name);
    const names = [...mappedRoomSearchNames(mapped ?? { name }), name].map((value) => normalizeRoomName(value).replaceAll(' ', ''));
    const matches = sharedRooms.filter((room) => room.buildingId === buildingId && names.includes(normalizeRoomName(room.label).replaceAll(' ', '')) && (floor === undefined || floor === null || room.floor === floor));
    return matches.length === 1 ? matches[0] : undefined;
  };
  for (const building of campusBuildings) {
    const search = [building.name, building.shortName, building.shortCode, ...building.aliases];
    result.push({ id: `building:${building.id}`, kind: 'building', buildingId: building.id, title: building.name, detail: `${building.shortCode} · Bâtiment`, search, floors: [] });
    for (const room of building.rooms) {
      const shared = findMappedRoom(building, room.name)?.id === room.id ? sharedForName(building.id, room.name) : undefined;
      if (shared) represented.add(shared.id);
      const floors = shared?.floor !== null && shared?.floor !== undefined ? [shared.floor] : room.floors;
      result.push({
        id: `room:${room.id}`, kind: 'room', buildingId: building.id, title: room.name,
        detail: `${building.shortCode} · ${floorsLabel(floors)}`, search: [...mappedRoomSearchNames(room), ...search.map((field) => `${room.name} ${field}`)],
        roomId: room.id, roomName: room.name, entranceId: room.entranceId, side: room.side, floors, tag: shared,
      });
    }
    for (const course of building.classes) {
      const room = findMappedRoom(building, course.room);
      const shared = sharedForName(building.id, course.room, course.floor);
      result.push({
        id: `catalog:${building.id}:${course.code}`, kind: 'course', buildingId: building.id,
        title: course.title, detail: `${course.code} · ${course.room} · ${building.shortCode}`,
        search: [`${course.code} ${course.title} ${course.room}`, ...search],
        roomId: room?.id, roomName: course.room, entranceId: room?.entranceId, side: room?.side, floors: roomFloors(course.floor, shared), tag: shared,
      });
    }
  }
  for (const room of sharedRooms) {
    if (represented.has(room.id)) continue;
    const building = findBuilding(room.buildingId);
    if (!building) continue;
    result.push({ id: `location:${room.id}`, kind: 'room', buildingId: room.buildingId, title: room.label, roomName: room.label,
      detail: `${building.shortCode} · ${floorLabel(room.floor)}`, search: [room.label, `${room.label} ${building.name} ${building.shortCode}`], floors: roomFloors(null, room), tag: room,
    });
  }
  for (const course of classes) {
    const building = findBuilding(course.buildingId);
    if (!building) continue;
    const room = findMappedRoom(building, course.room);
    const shared = sharedForName(building.id, course.room, course.floor);
    result.push({
      id: `course:${course.id}`, kind: 'course', buildingId: building.id, courseId: course.id,
      title: course.label || course.title, detail: `Mon cours · ${course.room} · ${building.shortCode} · ${floorLabel(course.floor)}`,
      search: [`${course.label} ${course.title} ${course.catalogCode ?? ''} ${course.room}`, `${course.room} ${building.name} ${building.shortCode}`],
      roomId: room?.id, roomName: course.room, entranceId: room?.entranceId, side: room?.side, floors: roomFloors(course.floor, shared), tag: shared,
    });
  }
  for (const tag of tags) {
    if (sharedIds.has(tag.id)) continue;
    const building = findBuilding(tag.buildingId);
    if (!building) continue;
    const room = findMappedRoom(building, tag.label);
    result.push({
      id: `tag:${tag.id}`, kind: 'tag', buildingId: building.id, title: tag.label,
      detail: `Mon repère · ${building.shortCode} · ${floorLabel(tag.floor)}`, search: [`${tag.label} ${building.shortCode} ${building.name}`],
      tag, roomId: room?.id, roomName: tag.label, entranceId: room?.entranceId, side: room?.side, floors: tag.floor === null ? [] : [tag.floor],
    });
  }
  return result;
}

export function searchDestinations(query: string, destinations: NavigationDestination[]): NavigationDestination[] {
  const needle = normalizeDestination(query);
  if (!needle) return destinations.filter((entry) => entry.kind === 'course' || entry.kind === 'room' || entry.kind === 'tag');
  const tokens = needle.split(/\s+/);
  const score = (entry: NavigationDestination) => {
    const title = normalizeDestination(entry.title);
    return (exactDestinationMatch(query, entry) ? 100 : title.startsWith(needle) ? 60 : title.includes(needle) ? 40 : 0) + (entry.kind === 'course' || entry.kind === 'tag' ? 5 : 0);
  };
  return destinations.filter((entry) => entry.search.some((field) => {
    const normalized = normalizeDestination(field);
    return tokens.every((token) => normalized.includes(token) || normalized.replaceAll(' ', '').includes(token));
  })).sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, 'fr', { numeric: true }));
}

/** Destination links never contain the user's position or GPS history. */
export function navigationUrl(destination: string): string {
  return `/map?${new URLSearchParams({ navigate: '1', destination })}`;
}
