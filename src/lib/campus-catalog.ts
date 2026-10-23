import campusJson from '../data/campus.json';
import type { BuildingCategory, BuildingSide, CampusBuilding, CampusData } from '../data/types';
import { parseCampusData } from './campus-validation';
import { mappedRoomSearchNames, normalizeRoomName } from './room-names';
import { publishedRoomTags } from './published-room-locations';

/**
 * The catalog is validated once at module load. A malformed campus.json must fail
 * loudly in development and at build time rather than render an empty campus.
 * The JSON is hand-maintained after the one-off scripts/seed-campus.ts bootstrap.
 */
export const campusData: CampusData = parseCampusData(campusJson);

export const buildingNodeName = (id: string): string => `building_${id.replace('/', '_')}`;

const byCode = (first: CampusBuilding, second: CampusBuilding) =>
  first.shortCode.localeCompare(second.shortCode, 'fr', { numeric: true, sensitivity: 'base' });

/** Canonical catalog order, stable across renders. */
export const campusBuildings: CampusBuilding[] = [...campusData.buildings].sort(byCode);

export function findBuilding(id: string | null | undefined): CampusBuilding | null {
  if (!id) return null;
  return campusBuildings.find((building) => building.id === id) ?? null;
}

export const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  department: 'Département',
  teaching: 'Enseignement',
  service: 'Services',
  life: 'Vie du campus',
};

export const CATEGORY_FILTER_LABEL: Record<BuildingCategory, string> = {
  department: 'Départements',
  teaching: 'Enseignement',
  service: 'Services',
  life: 'Vie du campus',
};

export const floorsSourceLabel: Record<CampusBuilding['floorsSource'], string> = {
  osm: 'niveaux OpenStreetMap',
  estimated: 'niveaux estimés',
  'mapped-rooms': 'niveaux déduits des salles',
};

export const SIDE_LABEL: Record<BuildingSide, string> = {
  front: 'Face avant',
  rear: 'Face arrière',
};

export const campusStats = {
  buildings: campusData.buildings.length,
  rooms: campusData.buildings.reduce((sum, building) => sum + building.rooms.length, 0),
  entrances: campusData.buildings.reduce((sum, building) => sum + building.entrances.length, 0) + campusData.unassignedEntrances.length,
  associatedEntrances: campusData.buildings.reduce((sum, building) => sum + building.entrances.length, 0),
  unassignedEntrances: campusData.unassignedEntrances.length,
  classes: campusData.buildings.reduce((sum, building) => sum + building.classes.length, 0),
  walkNodes: campusData.walkNodes.length,
  walkEdges: campusData.walkEdges.length,
} as const;

export const floorLabel = (floor: number | null): string => floor === null ? 'Niveau à préciser' : floor === 0 ? 'RDC' : floor === 1 ? '1er étage' : floor < 0 ? `Niveau ${floor}` : `${floor}e étage`;
export const floorsLabel = (floors: number[]): string => floors.length ? floors.map(floorLabel).join(' · ') : 'Niveau non renseigné';

const normalizeSearch = normalizeRoomName;

function searchFields(building: CampusBuilding): string[] {
  return [
    building.name,
    building.shortName,
    building.shortCode,
    ...building.aliases,
    CATEGORY_LABEL[building.category],
    ...building.rooms.flatMap(mappedRoomSearchNames),
    ...publishedRoomTags.filter((room) => room.buildingId === building.id).map((room) => room.label),
    ...building.classes.map((course) => `${course.code} ${course.title} ${course.room}`),
  ];
}

/** Match each query within one field, so “Amphi 2” cannot combine unrelated rooms. */
export function searchCampusBuildings(query: string, category: BuildingCategory | 'all' = 'all', buildings: CampusBuilding[] = campusBuildings): CampusBuilding[] {
  const needle = normalizeSearch(query);
  const tokens = needle.split(/\s+/).filter(Boolean);
  return buildings.filter((building) => {
    if (category !== 'all' && building.category !== category) return false;
    if (!needle) return true;
    return searchFields(building).some((field) => {
      const normalized = normalizeSearch(field);
      const compact = normalized.replaceAll(' ', '');
      return tokens.every((token) => normalized.includes(token) || compact.includes(token));
    });
  });
}
