import type { CampusData } from '../data/types';

function requireValue(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) throw new Error(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  requireValue(Array.isArray(value), path, 'expected an array');
  return value;
}

function text(value: unknown, path: string): string {
  requireValue(typeof value === 'string' && value.trim().length > 0, path, 'expected non-empty text');
  return value;
}

function number(value: unknown, path: string): number {
  requireValue(typeof value === 'number' && Number.isFinite(value), path, 'expected a finite number');
  return value;
}

function flag(value: unknown, path: string) {
  requireValue(typeof value === 'boolean', path, 'expected a boolean');
}

function choice(value: unknown, choices: readonly unknown[], path: string) {
  requireValue(choices.includes(value), path, `expected one of ${choices.join(', ')}`);
}

function unique(value: unknown, seen: Set<string>, path: string): string {
  const identifier = text(value, path);
  requireValue(!seen.has(identifier), path, `duplicate identifier ${identifier}`);
  seen.add(identifier);
  return identifier;
}

function point(value: Record<string, unknown>, path: string) {
  requireValue(Math.abs(number(value.lat, `${path}.lat`)) <= 90, path, 'latitude out of range');
  requireValue(Math.abs(number(value.lng, `${path}.lng`)) <= 180, path, 'longitude out of range');
}

function position(value: unknown, path: string) {
  const coordinates = record(value, path);
  for (const axis of ['x', 'y', 'z']) number(coordinates[axis], `${path}.${axis}`);
}

function floors(value: unknown, path: string) {
  const values = list(value, path);
  values.forEach((floor) => requireValue(Number.isInteger(floor), path, 'floor numbers must be integers'));
  requireValue(new Set(values).size === values.length, path, 'duplicate floor numbers');
}

function strings(value: unknown, path: string) {
  list(value, path).forEach((entry, index) => text(entry, `${path}[${index}]`));
}

/** Shared by the build check and future editor imports; never trust a JSON cast alone. */
export function parseCampusData(value: unknown): CampusData {
  const data = record(value, 'campus');
  requireValue(data.schemaVersion === 1, 'schemaVersion', 'unsupported campus format');
  for (const field of ['id', 'name', 'timezone', 'locale']) text(data[field], field);
  try {
    new Intl.DateTimeFormat(data.locale as string, { timeZone: data.timezone as string });
  } catch {
    throw new Error('campus: invalid locale or timezone');
  }
  const coordinates = record(data.coordinates, 'coordinates');
  point(record(coordinates.origin, 'coordinates.origin'), 'coordinates.origin');
  for (const [axis, expected] of Object.entries({ units: 'metres', east: '+X', up: '+Y', north: '-Z' })) {
    requireValue(coordinates[axis] === expected, `coordinates.${axis}`, `expected ${expected}`);
  }
  const source = record(data.source, 'source');
  for (const field of ['attribution', 'license', 'url', 'retrievedAt']) text(source[field], `source.${field}`);
  requireValue(/^https:\/\//.test(source.url as string), 'source.url', 'expected an HTTPS attribution link');
  requireValue(Number.isFinite(Date.parse(source.retrievedAt as string)), 'source.retrievedAt', 'invalid date');
  strings(data.notes, 'notes');

  const buildingIds = new Set<string>();
  const nodeNames = new Set<string>();
  const shortCodes = new Set<string>();
  const roomIds = new Set<string>();
  const entranceIds = new Set<string>();
  const readEntrance = (value: unknown, path: string, unassigned: boolean) => {
    const entrance = record(value, path);
    const identifier = unique(entrance.id, entranceIds, `${path}.id`);
    for (const field of ['name', 'access']) text(entrance[field], `${path}.${field}`);
    point(entrance, path);
    position(entrance.position, `${path}.position`);
    floors(entrance.floors, `${path}.floors`);
    choice(entrance.kind, ['main', 'secondary', 'entrance'], `${path}.kind`);
    choice(entrance.association, unassigned ? ['unassigned'] : ['osm-outline', 'user-correction'], `${path}.association`);
    choice(entrance.wheelchair, ['yes', 'no', 'limited', 'unknown'], `${path}.wheelchair`);
    if (entrance.side !== undefined) choice(entrance.side, ['front', 'rear'], `${path}.side`);
    flag(entrance.verified, `${path}.verified`);
    requireValue(!unassigned || entrance.verified === false, path, 'an unassigned entrance cannot be verified');
    return identifier;
  };

  const buildings = list(data.buildings, 'buildings');
  requireValue(buildings.length > 0, 'buildings', 'at least one building is required');
  buildings.forEach((value, index) => {
    const path = `buildings[${index}]`;
    const building = record(value, path);
    unique(building.id, buildingIds, `${path}.id`);
    unique(building.modelNodeName, nodeNames, `${path}.modelNodeName`);
    unique(text(building.shortCode, `${path}.shortCode`).toLocaleUpperCase('fr'), shortCodes, `${path}.shortCode`);
    for (const field of ['name', 'shortName']) text(building[field], `${path}.${field}`);
    for (const field of ['aliases', 'notes']) strings(building[field], `${path}.${field}`);
    choice(building.nameSource, ['osm', 'user-correction', 'map-index'], `${path}.nameSource`);
    choice(building.category, ['department', 'teaching', 'service', 'life'], `${path}.category`);
    choice(building.floorsSource, ['osm', 'estimated', 'mapped-rooms'], `${path}.floorsSource`);
    choice(building.landmark, ['primary', 'secondary', null], `${path}.landmark`);
    point(building, path);
    position(building.position, `${path}.position`);
    requireValue(Number.isInteger(building.floors) && number(building.floors, `${path}.floors`) > 0, path, 'floors must be a positive level count');
    for (const field of ['height', 'footprintArea']) requireValue(number(building[field], `${path}.${field}`) > 0, path, `${field} must be positive`);
    flag(building.heightEstimated, `${path}.heightEstimated`);
    const localEntrances = new Set(list(building.entrances, `${path}.entrances`).map((entry, entranceIndex) => readEntrance(entry, `${path}.entrances[${entranceIndex}]`, false)));
    list(building.rooms, `${path}.rooms`).forEach((entry, roomIndex) => {
      const roomPath = `${path}.rooms[${roomIndex}]`;
      const room = record(entry, roomPath);
      unique(room.id, roomIds, `${roomPath}.id`);
      for (const field of ['name', 'type']) text(room[field], `${roomPath}.${field}`);
      floors(room.floors, `${roomPath}.floors`);
      if (room.side !== undefined) choice(room.side, ['front', 'rear'], `${roomPath}.side`);
      if (room.entranceId !== undefined) requireValue(localEntrances.has(text(room.entranceId, `${roomPath}.entranceId`)), roomPath, 'entrance must belong to this building');
    });
    const codes = new Set<string>();
    list(building.classes, `${path}.classes`).forEach((entry, classIndex) => {
      const classPath = `${path}.classes[${classIndex}]`;
      const course = record(entry, classPath);
      unique(text(course.code, `${classPath}.code`).toLocaleUpperCase('fr'), codes, `${classPath}.code`);
      for (const field of ['title', 'room']) text(course[field], `${classPath}.${field}`);
      requireValue(course.floor === null || Number.isInteger(course.floor), `${classPath}.floor`, 'expected an integer or null for an unknown floor');
    });
  });
  list(data.unassignedEntrances, 'unassignedEntrances').forEach((entry, index) => readEntrance(entry, `unassignedEntrances[${index}]`, true));
  list(data.corrections, 'corrections').forEach((entry, index) => {
    const path = `corrections[${index}]`;
    const correction = record(entry, path);
    requireValue(buildingIds.has(text(correction.buildingId, `${path}.buildingId`)), path, 'unknown building');
    text(correction.description, `${path}.description`);
    requireValue(Number.isFinite(Date.parse(text(correction.recordedAt, `${path}.recordedAt`))), path, 'invalid date');
  });

  const walkIds = new Set<string>();
  list(data.walkNodes, 'walkNodes').forEach((entry, index) => {
    const path = `walkNodes[${index}]`;
    const node = record(entry, path);
    unique(node.id, walkIds, `${path}.id`);
    point(node, path);
    position(node.position, `${path}.position`);
    if (node.entranceId !== undefined) requireValue(entranceIds.has(text(node.entranceId, `${path}.entranceId`)), path, 'unknown entrance');
  });
  const edgeIds = new Set<string>();
  list(data.walkEdges, 'walkEdges').forEach((entry, index) => {
    const path = `walkEdges[${index}]`;
    const edge = record(entry, path);
    unique(edge.id, edgeIds, `${path}.id`);
    for (const field of ['from', 'to']) requireValue(walkIds.has(text(edge[field], `${path}.${field}`)), path, 'unknown walk node');
    requireValue(edge.from !== edge.to, path, 'an edge cannot connect a node to itself');
    requireValue(number(edge.distanceMeters, `${path}.distanceMeters`) > 0, path, 'distance must be positive');
    flag(edge.bidirectional, `${path}.bidirectional`);
    flag(edge.verified, `${path}.verified`);
    requireValue(edge.accessible === null || typeof edge.accessible === 'boolean', path, 'accessible must be a boolean or null');
  });
  return value as CampusData;
}
