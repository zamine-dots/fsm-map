export interface GeographicPoint {
  lat: number;
  lng: number;
}

/** Model metres: east +X, up +Y, north -Z. These are not surveyed elevations. */
export interface ModelPosition {
  x: number;
  y: number;
  z: number;
}

export type BuildingCategory = 'department' | 'teaching' | 'service' | 'life';
export type BuildingSide = 'front' | 'rear';

export interface CampusClass {
  code: string;
  title: string;
  room: string;
  /** Zero is the ground floor; null means the floor has not been confirmed. */
  floor: number | null;
}

/** A mapped space is not a course. Multi-level rooms remain a single record. */
export interface MappedRoom {
  id: string;
  name: string;
  type: string;
  floors: number[];
  side?: BuildingSide;
  entranceId?: string;
}

export interface CampusEntrance extends GeographicPoint {
  id: string;
  name: string;
  position: ModelPosition;
  floors: number[];
  kind: 'main' | 'secondary' | 'entrance';
  association: 'osm-outline' | 'user-correction' | 'unassigned';
  side?: BuildingSide;
  access: string;
  wheelchair: 'yes' | 'no' | 'limited' | 'unknown';
  /** On-site confirmation. Suggested outdoor routes may use an unverified mapped door with an explicit notice. */
  verified: boolean;
}

export interface CampusBuilding extends GeographicPoint {
  id: string;
  name: string;
  shortName: string;
  shortCode: string;
  aliases: string[];
  nameSource: 'osm' | 'user-correction' | 'map-index';
  category: BuildingCategory;
  modelNodeName: string;
  position: ModelPosition;
  height: number;
  heightEstimated: boolean;
  footprintArea: number;
  /** Total level count, including the ground floor; not the highest floor number. */
  floors: number;
  floorsSource: 'osm' | 'estimated' | 'mapped-rooms';
  landmark: 'primary' | 'secondary' | null;
  entrances: CampusEntrance[];
  rooms: MappedRoom[];
  classes: CampusClass[];
  notes: string[];
}

export interface WalkNode extends GeographicPoint {
  id: string;
  position: ModelPosition;
  entranceId?: string;
}

export interface WalkEdge {
  id: string;
  from: string;
  to: string;
  distanceMeters: number;
  bidirectional: boolean;
  accessible: boolean | null;
  verified: boolean;
}

export interface CampusData {
  schemaVersion: 1;
  id: string;
  name: string;
  timezone: string;
  locale: string;
  coordinates: {
    origin: GeographicPoint;
    units: 'metres';
    east: '+X';
    up: '+Y';
    north: '-Z';
  };
  source: {
    attribution: string;
    license: string;
    url: string;
    retrievedAt: string;
  };
  corrections: { buildingId: string; description: string; recordedAt: string }[];
  notes: string[];
  buildings: CampusBuilding[];
  /** Source points without a confirmed building association; never nearest-building guesses. */
  unassignedEntrances: CampusEntrance[];
  walkNodes: WalkNode[];
  walkEdges: WalkEdge[];
}

/** ISO weekdays: Monday is 1, Sunday is 7. Times are campus-local, not device-local. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A personal snapshot survives subsequent edits to the campus course catalogue. */
export interface ScheduledClass {
  id: string;
  buildingId: string;
  catalogCode: string | null;
  title: string;
  room: string;
  floor: number | null;
  label: string;
  days: Weekday[];
  startTime: string;
  endTime: string;
}

export interface ScheduleBackup {
  format: 'fsm-navigator-schedule';
  version: 1;
  campusId: string;
  timezone: string;
  exportedAt: string;
  classes: ScheduledClass[];
}
