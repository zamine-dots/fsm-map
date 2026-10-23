export type Coordinate = [number, number];
export type Polygon = Coordinate[][];
export type Geometry =
  | { type: 'Point'; coordinates: Coordinate }
  | { type: 'LineString'; coordinates: Coordinate[] }
  | { type: 'Polygon'; coordinates: Polygon }
  | { type: 'MultiPolygon'; coordinates: Polygon[] };

export type FeatureKind = 'boundary' | 'building' | 'road' | 'path' | 'garden' | 'pitch' | 'parking' | 'room' | 'corridor' | 'tree' | 'entrance' | 'poi' | 'wall';

export interface MapFeature {
  type: 'Feature';
  id: string;
  properties: {
    osmType: 'node' | 'way' | 'relation';
    osmId: string;
    kind: FeatureKind;
    campus: boolean;
    name: string;
    tags: Record<string, string>;
  };
  geometry: Geometry;
}

export interface CampusData {
  type: 'FeatureCollection';
  metadata: {
    name: string;
    origin: Coordinate;
    retrievedAt: string;
    source: string;
    sourceUrl: string;
    attribution: string;
    license: string;
    licenseUrl: string;
    notes: string;
  };
  features: MapFeature[];
}

export type Category = 'department' | 'teaching' | 'service' | 'life';
export type CategoryFilter = 'all' | Category;
export type BuildingEdits = Record<string, { name: string; levels: number }>;

export interface CampusRoom {
  id: string;
  name: string;
  level: number;
  levels: number[];
  side?: BuildingSide;
  entrance?: Coordinate;
  type: string;
  area: number;
  polygons: Polygon[];
  center: Coordinate;
  feature: MapFeature;
}

export interface CampusBuilding {
  id: string;
  number: string;
  name: string;
  shortName: string;
  named: boolean;
  category: Category;
  levels: number;
  levelsEstimated: boolean;
  levelsFromRooms: boolean;
  height: number;
  heightEstimated: boolean;
  area: number;
  center: Coordinate;
  polygons: Polygon[];
  campus: boolean;
  roof: boolean;
  edited: boolean;
  correction?: CampusCorrection;
  rooms: CampusRoom[];
  feature: MapFeature;
}

export interface CampusModel {
  data: CampusData;
  features: MapFeature[];
  buildings: CampusBuilding[];
  campusBuildings: CampusBuilding[];
  rooms: CampusRoom[];
  boundary: Polygon;
  area: number;
}

export interface MapLayers {
  buildings: boolean;
  greenery: boolean;
  paths: boolean;
  labels: boolean;
  details: boolean;
  boundary: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  buildings: true,
  greenery: true,
  paths: true,
  labels: true,
  details: true,
  boundary: true,
};

export const CATEGORY_META: Record<Category, { label: string; description: string; color: string; roof: string }> = {
  department: { label: 'Département', description: 'Enseignement & recherche', color: '#36765c', roof: '#c7d3b7' },
  teaching: { label: 'Enseignement', description: 'Salles & espaces pédagogiques', color: '#b38d5d', roof: '#dcc3a0' },
  service: { label: 'Services', description: 'Les services du campus', color: '#658e9b', roof: '#bfd2cc' },
  life: { label: 'Vie du campus', description: 'La vie au quotidien', color: '#ae7863', roof: '#d7bba4' },
};

export const normalise = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[’']/g, ' ').trim();

export function project(point: Coordinate, origin: Coordinate): Coordinate {
  return [
    (point[0] - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180),
    (origin[1] - point[1]) * 111320,
  ];
}

export function projectGeometry(geometry: Geometry, origin: Coordinate): Geometry {
  switch (geometry.type) {
    case 'Point': return { type: 'Point', coordinates: project(geometry.coordinates, origin) };
    case 'LineString': return { type: 'LineString', coordinates: geometry.coordinates.map((point) => project(point, origin)) };
    case 'Polygon': return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map((point) => project(point, origin))) };
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map((point) => project(point, origin)))) };
  }
}

export function polygonsOf(geometry: Geometry): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function ringArea(ring: Coordinate[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index++) {
    const next = ring[(index + 1) % ring.length];
    twiceArea += ring[index][0] * next[1] - next[0] * ring[index][1];
  }
  return Math.abs(twiceArea) / 2;
}

export function polygonArea(polygon: Polygon): number {
  return ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
}

export function insideRing(point: Coordinate, ring: Coordinate[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const start = ring[current];
    const end = ring[previous];
    if ((start[1] > point[1]) !== (end[1] > point[1]) && point[0] < (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]) inside = !inside;
  }
  return inside;
}

export const insidePolygon = (point: Coordinate, polygon: Polygon) => insideRing(point, polygon[0]) && !polygon.slice(1).some((ring) => insideRing(point, ring));

export function centroid(ring: Coordinate[]): Coordinate {
  let area = 0;
  let horizontal = 0;
  let vertical = 0;
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    area += cross;
    horizontal += (point[0] + next[0]) * cross;
    vertical += (point[1] + next[1]) * cross;
  }
  if (Math.abs(area) < 0.00001) return ring[0];
  return [horizontal / (3 * area), vertical / (3 * area)];
}

export function boundsOf(points: Coordinate[]) {
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

export function distanceToSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const horizontal = end[0] - start[0];
  const vertical = end[1] - start[1];
  const lengthSquared = horizontal * horizontal + vertical * vertical;
  const position = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * horizontal + (point[1] - start[1]) * vertical) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - position * horizontal, point[1] - start[1] - position * vertical);
}

function categoryFor(feature: MapFeature, name: string): Category {
  const text = normalise(name);
  if (/depart.*ment/.test(text)) return 'department';
  if (/club|bibliotheque|restaurant|cafe/.test(text)) return 'life';
  if (/administration|infirmerie|tirage|magasin/.test(text) || ['office', 'service', 'garages'].includes(feature.properties.tags.building)) return 'service';
  return 'teaching';
}

const numericTag = (value?: string) => {
  if (!value) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

export function parseLevels(value?: string): number[] {
  const levels = [...new Set((value ?? '0').split(';').filter((entry) => entry.trim() !== '').map(Number).filter(Number.isFinite))].sort((first, second) => first - second);
  return levels.length ? levels : [0];
}

export function prepareCampus(data: CampusData, edits: BuildingEdits = {}): CampusModel {
  const features = data.features.map((feature) => ({ ...feature, geometry: projectGeometry(feature.geometry, data.metadata.origin) }));
  const boundaryFeature = features.find((feature) => feature.properties.kind === 'boundary');
  if (!boundaryFeature) throw new Error('La limite du campus est introuvable.');
  const boundary = polygonsOf(boundaryFeature.geometry)[0];
  if (!boundary) throw new Error('La limite du campus est invalide.');

  const rooms: CampusRoom[] = features.filter((feature) => feature.properties.kind === 'room').map((feature) => {
    const polygons = polygonsOf(feature.geometry);
    const levels = parseLevels(feature.properties.tags.level);
    const name = feature.properties.name || (feature.properties.tags.room === 'toilets' ? 'Sanitaires' : 'Salle sans nom');
    return {
      id: feature.id,
      name,
      level: levels[0],
      levels,
      type: /^amphi\b/.test(normalise(name)) ? 'amphitheatre' : feature.properties.tags.room ?? 'room',
      area: polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0),
      center: centroid(polygons[0][0]),
      polygons,
      feature,
    };
  });

  let buildingIndex = 0;
  const buildings = features.filter((feature) => feature.properties.kind === 'building' && polygonsOf(feature.geometry).length > 0).map((feature): CampusBuilding => {
    const tags = feature.properties.tags;
    const polygons = polygonsOf(feature.geometry);
    const mainPolygon = [...polygons].sort((first, second) => polygonArea(second) - polygonArea(first))[0];
    const campus = feature.properties.campus;
    const roof = tags.building === 'roof';
    const number = campus && !roof ? String(++buildingIndex).padStart(2, '0') : '';
    const edit = edits[feature.id];
    const correction = CAMPUS_CORRECTIONS[feature.id];
    const sourceName = feature.properties.name.replace(/Départment/g, 'Département');
    const name = edit?.name || correction?.name || sourceName || (roof ? 'Passage couvert' : `Bâtiment ${number || 'voisin'}`);
    const knownLevels = numericTag(tags['building:levels']);
    const levels = edit?.levels ?? knownLevels ?? (tags.building === 'university' ? 2 : 1);
    const knownHeight = edit ? undefined : numericTag(tags.height);
    return {
      id: feature.id,
      number,
      name,
      shortName: name.replace(/^Département (de |d['’])/, '').replace(/^Locaux Communs /, 'LC ').replace(/^Amphithéâtres /, 'Amphis ').replace('Restaurant Universitaire Skanes Monastir', 'Restaurant universitaire'),
      named: Boolean(edit?.name || correction?.name || sourceName),
      category: categoryFor(feature, name),
      levels,
      levelsEstimated: !edit && knownLevels === undefined,
      levelsFromRooms: false,
      height: roof ? 3.2 : knownHeight ?? levels * 3.5,
      heightEstimated: knownHeight === undefined,
      area: polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0),
      center: centroid(mainPolygon[0]),
      polygons,
      campus,
      roof,
      edited: Boolean(edit),
      correction,
      rooms: [],
      feature,
    };
  });

  for (const room of rooms) {
    const parent = buildings.filter((building) => !building.roof && building.polygons.some((polygon) => insidePolygon(room.center, polygon))).sort((first, second) => first.area - second.area)[0];
    if (parent) {
      const correction = parent.correction?.rooms[room.id];
      if (correction) {
        room.side = correction.side;
        const entrance = features.find((feature) => feature.id === correction.entranceId);
        if (entrance?.geometry.type === 'Point') room.entrance = entrance.geometry.coordinates;
      }
      parent.rooms.push(room);
    }
  }

  for (const building of buildings) {
    if (building.edited || building.roof || !building.rooms.length) continue;
    const roomLevels = Math.max(...building.rooms.flatMap((room) => room.levels)) + 1;
    if (roomLevels > building.levels) {
      building.levels = roomLevels;
      building.levelsEstimated = true;
      building.levelsFromRooms = true;
      if (building.heightEstimated) building.height = roomLevels * 3.5;
    }
  }

  return {
    data,
    features,
    buildings,
    campusBuildings: buildings.filter((building) => building.campus && !building.roof).sort((first, second) => Number(second.named) - Number(first.named) || first.name.localeCompare(second.name, 'fr')),
    rooms,
    boundary,
    area: polygonArea(boundary),
  };
}

export function readEdits(): BuildingEdits {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('fsm-building-edits-v1') ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, edit]) => /^(way|relation)\/\d+$/.test(id) && edit && typeof edit === 'object' && typeof edit.name === 'string' && edit.name.length <= 100 && Number.isInteger(edit.levels) && edit.levels >= 1 && edit.levels <= 12));
  } catch {
    return {};
  }
}

export function saveEdits(edits: BuildingEdits): boolean {
  try {
    localStorage.setItem('fsm-building-edits-v1', JSON.stringify(edits));
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportGeoJSON(data: CampusData, edits: BuildingEdits) {
  const result = {
    ...data,
    metadata: { ...data.metadata, campusCorrections: CAMPUS_CORRECTIONS, localEdits: Object.keys(edits).length, exportedAt: new Date().toISOString() },
    features: data.features.map((feature) => edits[feature.id] ? {
      ...feature,
      properties: { ...feature.properties, localEdit: edits[feature.id], editSource: 'Local user correction; not verified by OpenStreetMap' },
    } : feature),
  };
  downloadFile(JSON.stringify(result, null, 2), 'fsm-campus.geojson', 'application/geo+json');
}
import { CAMPUS_CORRECTIONS, type BuildingSide, type CampusCorrection } from '../data/campus-corrections.ts';
