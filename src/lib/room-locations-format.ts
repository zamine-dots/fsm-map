import { MAX_BUILDING_TAGS, parseBuildingTag, pointInFootprint, type BuildingTag } from './building-tags.ts';
import type { Polygon } from './campus.ts';

export interface RoomLocation {
  id: string;
  buildingId: string;
  name: string;
  floor: number | null;
  point: [number, number];
}
export interface RoomLocationsData {
  format: 'fsm-room-locations';
  version: 1;
  campusId: 'fsm-campus';
  coordinates: 'local-metres';
  updatedAt: string | null;
  locations: RoomLocation[];
}

export function parseRoomLocations(value: unknown): RoomLocationsData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Plan des salles invalide.');
  const data = value as Record<string, unknown>;
  if (data.format !== 'fsm-room-locations' || data.version !== 1 || data.campusId !== 'fsm-campus' || data.coordinates !== 'local-metres') throw new Error('Format du plan des salles non reconnu.');
  if (data.updatedAt !== null && (typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt)))) throw new Error('Date du plan des salles invalide.');
  if (!Array.isArray(data.locations) || data.locations.length > MAX_BUILDING_TAGS) throw new Error(`Maximum ${MAX_BUILDING_TAGS} salles.`);
  const ids = new Set<string>();
  const locations = data.locations.map((value): RoomLocation => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Salle invalide.');
    const room = value as Record<string, unknown>;
    if (Object.keys(room).some((key) => !['id', 'buildingId', 'name', 'floor', 'point'].includes(key))) throw new Error('Une salle publiée ne contient que son nom, son bâtiment, son niveau et sa position.');
    const tag = parseBuildingTag({ ...room, label: room.name, courseId: null });
    if (ids.has(tag.id)) throw new Error('Deux salles ont le même identifiant.');
    ids.add(tag.id);
    return { id: tag.id, buildingId: tag.buildingId, name: tag.label, floor: tag.floor, point: tag.point };
  });
  return { format: 'fsm-room-locations', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', updatedAt: data.updatedAt as string | null, locations };
}

export function validateRoomLocationGeometry(data: RoomLocationsData, buildings: { id: string; polygons: Polygon[] }[]): void {
  for (const room of data.locations) {
    const building = buildings.find((entry) => entry.id === room.buildingId);
    if (!building) throw new Error(`Bâtiment inconnu pour « ${room.name} ».`);
    if (!pointInFootprint(room.point, building.polygons)) throw new Error(`La salle « ${room.name} » doit être placée dans son bâtiment, hors des cours ouvertes.`);
  }
}

/** Personal course IDs and schedules never enter the shared room-location file. */
export function roomLocationsFromTags(tags: BuildingTag[], updatedAt: string | null): RoomLocationsData {
  return parseRoomLocations({ format: 'fsm-room-locations', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', updatedAt,
    locations: tags.map((tag) => ({ id: tag.id, buildingId: tag.buildingId, name: tag.label, floor: tag.floor, point: tag.point })),
  });
}
