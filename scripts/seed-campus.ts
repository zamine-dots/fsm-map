/**
 * One-off generator for src/data/campus.json (Phase 3).
 *
 * This script is checked in for reproducibility but is intentionally NOT wired
 * into `npm run build` and never reads campus.json back. It bootstraps the
 * authoritative catalog from the OpenStreetMap snapshot plus the single
 * reviewed user correction. After that, src/data/campus.json is hand-maintained:
 * re-running this script refuses to overwrite manual edits. Use --stdout to
 * inspect a fresh seed without replacing the catalogue.
 *
 * Run manually with: npx tsx scripts/seed-campus.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CAMPUS_CORRECTIONS } from '../src/data/campus-corrections';
import type { CampusData, CampusEntrance, MappedRoom } from '../src/data/types';
import { parseLevels, prepareCampus, project, type Coordinate, type CampusRoom, type CampusData as GeoCampusData, type MapFeature } from '../src/lib/campus';

const ORIGIN: Coordinate = [10.80535, 35.7648];
const RETRIEVED_AT = '2026-10-02';
const METRES_PER_DEGREE = 111320;

const unproject = (point: Coordinate) => ({
  lng: ORIGIN[0] + point[0] / (METRES_PER_DEGREE * Math.cos(ORIGIN[1] * Math.PI / 180)),
  lat: ORIGIN[1] - point[1] / METRES_PER_DEGREE,
});

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

const kindOf = (tag?: string): CampusEntrance['kind'] => tag === 'main' ? 'main' : tag === 'secondary' ? 'secondary' : 'entrance';

interface ShortEntry { shortName: string; shortCode: string; landmark: 'primary' | 'secondary' | null }

const shortNames: Record<string, ShortEntry> = {
  'relation/3375365': { shortName: 'Physique 2', shortCode: 'PHY2', landmark: null },
  'relation/3375366': { shortName: 'LC 3', shortCode: 'LC3', landmark: null },
  'relation/3375367': { shortName: 'Chimie 2', shortCode: 'CHI2', landmark: null },
  'relation/3375368': { shortName: 'LC 1', shortCode: 'LC1', landmark: 'primary' },
  'relation/3375369': { shortName: 'Bâtiment 05', shortCode: 'B05', landmark: null },
  'way/126064593': { shortName: 'Physique', shortCode: 'PHY', landmark: 'secondary' },
  'way/126064600': { shortName: 'Mathématiques', shortCode: 'MATH', landmark: 'secondary' },
  'way/126064608': { shortName: 'Chimie', shortCode: 'CHI', landmark: null },
  'way/126064613': { shortName: 'Administration', shortCode: 'ADMIN', landmark: null },
  'way/126064615': { shortName: 'Informatique', shortCode: 'INFO', landmark: 'secondary' },
  'way/126064619': { shortName: 'LC 2', shortCode: 'LC2', landmark: null },
  'way/251554015': { shortName: 'Infirmerie', shortCode: 'INFIR', landmark: null },
  'way/251554017': { shortName: 'Bâtiment 13', shortCode: 'B13', landmark: null },
  'way/251554018': { shortName: 'Bâtiment 14', shortCode: 'B14', landmark: null },
  'way/251554019': { shortName: 'Bâtiment 15', shortCode: 'B15', landmark: null },
  'way/251554020': { shortName: 'Clubs universitaires', shortCode: 'CLUBS', landmark: null },
  'way/251554021': { shortName: 'Bâtiment 17', shortCode: 'B17', landmark: null },
  'way/251554022': { shortName: 'Service tirage', shortCode: 'TIRAGE', landmark: null },
  'way/251554023': { shortName: 'Bâtiment 19', shortCode: 'B19', landmark: null },
  'way/251554024': { shortName: 'Bâtiment 20', shortCode: 'B20', landmark: null },
  'way/251554025': { shortName: 'Magasin', shortCode: 'MAGASIN', landmark: null },
  'way/251554026': { shortName: 'LC 4', shortCode: 'LC4', landmark: null },
  'way/251554027': { shortName: 'Bâtiment 23', shortCode: 'B23', landmark: null },
  'way/1202990233': { shortName: 'Salle des Thèses', shortCode: 'THESES', landmark: null },
  'way/1202990234': { shortName: 'Salle des Mastères', shortCode: 'MAST', landmark: null },
  'way/1202990235': { shortName: 'Bâtiment 26', shortCode: 'B26', landmark: null },
  'way/1203834931': { shortName: 'Amphis 1–6', shortCode: 'AMPHI', landmark: 'primary' },
  'way/1204140843': { shortName: 'Bâtiment 28', shortCode: 'B28', landmark: null },
};

const roomMeta: Record<string, { side?: MappedRoom['side']; entranceId?: string }> = {};
for (const correction of Object.values(CAMPUS_CORRECTIONS)) {
  for (const [roomId, detail] of Object.entries(correction.rooms)) roomMeta[roomId] = { side: detail.side, entranceId: detail.entranceId };
}

const associatedEntranceIds = new Set(Object.values(roomMeta).map((meta) => meta.entranceId).filter((id): id is string => Boolean(id)));

const ENTRANCE_NAMES: Record<string, string> = {
  'node/11151934117': 'Entrée Amphi 1 — face avant',
  'node/11151934116': 'Entrée Amphi 2 — face avant',
  'node/11151934115': 'Entrée Amphi 3 — face avant',
  'node/11151934121': 'Entrée Amphi 4 — face arrière',
  'node/11151934120': 'Entrée Amphi 5 — face arrière',
  'node/11151934119': 'Entrée Amphi 6 — face arrière',
};

function entranceRecord(feature: MapFeature, association: CampusEntrance['association']): CampusEntrance {
  const tags = feature.properties.tags;
  const coordinates = feature.geometry.type === 'Point' ? feature.geometry.coordinates : ([0, 0] as Coordinate);
  const local = project(coordinates, ORIGIN);
  const associated = association === 'user-correction';
  const room = Object.entries(roomMeta).find(([, meta]) => meta.entranceId === feature.id);
  const side = associated ? room?.[1].side : undefined;
  const name = ENTRANCE_NAMES[feature.id] ?? (tags.entrance === 'secondary' ? 'Entrée secondaire' : `Entrée OpenStreetMap ${feature.properties.osmId}`);
  return {
    id: feature.id,
    name,
    lat: coordinates[1],
    lng: coordinates[0],
    position: { x: round(local[0]), y: 0.28, z: round(local[1]) },
    floors: tags.level ? parseLevels(tags.level) : [],
    kind: kindOf(tags.entrance),
    association,
    ...(side ? { side } : {}),
    access: tags.access ?? 'unknown',
    wheelchair: tags.wheelchair === 'yes' || tags.wheelchair === 'no' || tags.wheelchair === 'limited' ? tags.wheelchair : 'unknown',
    verified: false,
  };
}

function modelRoom(room: CampusRoom): MappedRoom {
  const meta = roomMeta[room.id];
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    floors: room.levels,
    ...(meta?.side ? { side: meta.side } : {}),
    ...(meta?.entranceId ? { entranceId: meta.entranceId } : {}),
  };
}

function build(): CampusData {
  const data = JSON.parse(readFileSync('public/data/campus.geojson', 'utf8')) as GeoCampusData;
  const model = prepareCampus(data);
  const featureById = new Map(data.features.map((feature) => [feature.id, feature]));

  const buildings = model.campusBuildings.map<CampusData['buildings'][number]>((building) => {
    const meta = shortNames[building.id];
    if (!meta) throw new Error(`Missing short-name metadata for ${building.id}`);
    const feature = featureById.get(building.id);
    if (!feature) throw new Error(`Missing feature ${building.id}`);
    const geo = unproject(building.center);
    const correction = CAMPUS_CORRECTIONS[building.id];
    const aliases = new Set<string>();
    aliases.add(`Bâtiment ${building.number}`);
    aliases.add(`B${building.number}`);
    correction?.aliases.forEach((alias) => aliases.add(alias));
    if (feature.properties.name && feature.properties.name !== building.name) aliases.add(feature.properties.name);
    const nameSource: CampusData['buildings'][number]['nameSource'] = correction ? 'user-correction' : /^Bâtiment \d+$/.test(building.name) ? 'map-index' : 'osm';
    const floorsSource: CampusData['buildings'][number]['floorsSource'] = building.levelsFromRooms ? 'mapped-rooms' : building.levelsEstimated ? 'estimated' : 'osm';
    return {
      id: building.id,
      name: building.name,
      shortName: meta.shortName,
      shortCode: meta.shortCode,
      aliases: [...aliases],
      nameSource,
      category: building.category,
      modelNodeName: `building_${building.id.replace('/', '_')}`,
      position: { x: round(building.center[0]), y: 0.28, z: round(building.center[1]) },
      height: round(building.height, 3),
      heightEstimated: building.heightEstimated,
      footprintArea: round(building.area, 3),
      floors: building.levels,
      floorsSource,
      landmark: meta.landmark,
      entrances: [],
      rooms: building.rooms.map(modelRoom),
      classes: [],
      notes: [],
      lat: round(geo.lat, 8),
      lng: round(geo.lng, 8),
    };
  });

  for (const building of buildings) {
    const entranceIds = building.rooms.map((room) => room.entranceId).filter((id): id is string => Boolean(id));
    building.entrances = [...new Set(entranceIds)].map((entranceId) => {
      const feature = featureById.get(entranceId);
      if (!feature) throw new Error(`Missing entrance feature ${entranceId}`);
      return entranceRecord(feature, 'user-correction');
    });
  }

  const unassignedEntrances: CampusEntrance[] = [];
  for (const feature of data.features.filter((feature) => feature.properties.kind === 'entrance' && feature.properties.campus && !associatedEntranceIds.has(feature.id))) {
    if (feature.geometry.type !== 'Point') throw new Error(`Entrance ${feature.id} must be a point`);
    const point = project(feature.geometry.coordinates, ORIGIN);
    const matches = model.campusBuildings.filter((building) => building.polygons.some((polygon) => polygon.some((ring) => ring.some((vertex) => vertex[0] === point[0] && vertex[1] === point[1]))));
    const owner = matches.length === 1 ? buildings.find((building) => building.id === matches[0].id) : undefined;
    if (owner) owner.entrances.push(entranceRecord(feature, 'osm-outline'));
    else unassignedEntrances.push(entranceRecord(feature, 'unassigned'));
  }

  return {
    schemaVersion: 1,
    id: 'fsm-campus',
    name: 'Faculté des Sciences de Monastir',
    timezone: 'Africa/Tunis',
    locale: 'fr-TN',
    coordinates: { origin: { lat: 35.7648, lng: 10.80535 }, units: 'metres', east: '+X', up: '+Y', north: '-Z' },
    source: { attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', url: 'https://www.openstreetmap.org/copyright', retrievedAt: RETRIEVED_AT },
    corrections: [
      {
        buildingId: 'way/1203834931',
        description: 'User identification: Amphis 1, 2, 3 face the front; Amphis 4, 5, 6 face the rear. Room outlines and entrance positions come from OpenStreetMap.',
        recordedAt: RETRIEVED_AT,
      },
    ],
    notes: [
      'Emprises, noms et niveaux issus de l’instantané OpenStreetMap du 2 octobre 2026 ; les hauteurs sans relevé sont estimées à 3,5 m par niveau.',
      'Aucune liste de cours réelle n’est publiée à cette étape : les classes[] de chaque bâtiment sont volontairement vides. L’emploi du temps arrive à l’étape 4.',
      'Les entrées OpenStreetMap non rattachées topologiquement restent dans unassignedEntrances ; aucune association n’est devinée par proximité.',
      'Aucun cheminement piéton ou accessible n’est défini à cette étape : walkNodes et walkEdges restent vides. Le routage arrive à l’étape 6.',
      'Les six entrées des Amphis 1–6 sont rattachées par la correction utilisateur. Les autres associations exigent un sommet OSM partagé. Aucun accès n’est vérifié sur place.',
      'Les codes courts et les numéros sont des repères de l’application ; leur caractère officiel n’est pas confirmé.',
    ],
    buildings,
    unassignedEntrances,
    walkNodes: [],
    walkEdges: [],
  };
}

const campus = build();
const serialized = `${JSON.stringify(campus, null, 2)}\n`;
if (process.argv.includes('--stdout')) process.stdout.write(serialized);
else {
  writeFileSync('src/data/campus.json', serialized, { flag: 'wx' });
  console.log(`campus.json created: ${campus.buildings.length} buildings. Existing catalogues are never overwritten.`);
}
