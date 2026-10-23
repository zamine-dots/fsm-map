import snapshot from '../data/room-locations.json';
import type { BuildingTag } from './building-tags';
import { parseRoomLocations } from './room-locations-format';

export { roomLocationsFromTags } from './room-locations-format';
export const publishedRoomData = parseRoomLocations(snapshot);
export const publishedRoomTags: BuildingTag[] = publishedRoomData.locations.map((room) => ({ id: room.id, buildingId: room.buildingId, label: room.name, floor: room.floor, point: room.point, courseId: null }));
