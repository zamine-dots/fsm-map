/**
 * Read-only integrity check for src/data/campus.json (Phase 3).
 *
 * Asserts the hand-maintained catalog against the OpenStreetMap snapshot, the
 * derived campus model and the optimized GLB. It never writes campus.json and
 * must stay fast enough to run in `npm run build`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { prepareCampus, project, type CampusData as GeoCampusData } from '../src/lib/campus';
import { parseCampusData } from '../src/lib/campus-validation';
import type { CampusData } from '../src/data/types';
import { CAMPUS_CORRECTIONS } from '../src/data/campus-corrections';

const campusPath = 'src/data/campus.json';
const geojsonPath = 'public/data/campus.geojson';
const modelPath = 'public/model.glb';
const TOLERANCE = 0.01;

const campus: CampusData = parseCampusData(JSON.parse(readFileSync(campusPath, 'utf8')));
const geo = JSON.parse(readFileSync(geojsonPath, 'utf8')) as GeoCampusData;
const featureById = new Map(geo.features.map((feature) => [feature.id, feature]));
const derived = prepareCampus(geo);
const derivedById = new Map(derived.campusBuildings.map((building) => [building.id, building]));

// --- Counts -----------------------------------------------------------------
assert.deepEqual(campus.buildings.map((building) => building.id).sort(), derived.campusBuildings.map((building) => building.id).sort(), 'catalogue/model building IDs differ');
const rooms = campus.buildings.flatMap((building) => building.rooms);
assert.equal(rooms.length, derived.rooms.length, 'catalogue/model room counts differ');
const associated = campus.buildings.flatMap((building) => building.entrances);
const sourceEntrances = geo.features.filter((feature) => feature.properties.kind === 'entrance' && feature.properties.campus);
assert.deepEqual([...associated, ...campus.unassignedEntrances].map((entrance) => entrance.id).sort(), sourceEntrances.map((feature) => feature.id).sort(), 'catalogue must preserve every source entrance exactly once');

// --- Identifiers exist in the source snapshot as the right kind -------------
for (const building of campus.buildings) {
  const feature = featureById.get(building.id);
  assert(feature, `unknown building id ${building.id}`);
  assert.equal(feature!.properties.kind, 'building', `${building.id} is not a building feature`);
  assert(derivedById.has(building.id), `${building.id} is not a campus building in prepareCampus`);
}
for (const room of rooms) {
  const feature = featureById.get(room.id);
  assert(feature, `unknown room id ${room.id}`);
  assert.equal(feature!.properties.kind, 'room', `${room.id} is not a room feature`);
}
for (const entrance of [...associated, ...campus.unassignedEntrances]) {
  const feature = featureById.get(entrance.id);
  assert(feature, `unknown entrance id ${entrance.id}`);
  assert.equal(feature!.properties.kind, 'entrance', `${entrance.id} is not an entrance feature`);
  assert.equal(feature!.properties.campus, true, `${entrance.id} is not a campus entrance`);
}
for (const correction of campus.corrections) assert(CAMPUS_CORRECTIONS[correction.buildingId], `correction references an unknown building ${correction.buildingId}`);

// --- Room nesting, association and georeferencing ---------------------------
const derivedRoomOwner = new Map<string, string>();
for (const building of derived.campusBuildings) for (const room of building.rooms) derivedRoomOwner.set(room.id, building.id);
for (const building of campus.buildings) {
  const expectedRooms = derivedById.get(building.id)!.rooms.map((room) => room.id).sort();
  const actualRooms = building.rooms.map((room) => room.id).sort();
  assert.deepEqual(actualRooms, expectedRooms, `room nesting drift for ${building.id}`);
  for (const entrance of building.entrances.filter((entry) => entry.association === 'osm-outline')) {
    const point = project([entrance.lng, entrance.lat], geo.metadata.origin);
    const outline = derivedById.get(building.id)!.polygons;
    assert(outline.some((polygon) => polygon.some((ring) => ring.some((vertex) => Math.hypot(vertex[0] - point[0], vertex[1] - point[1]) < TOLERANCE))), `${entrance.id}: OSM association needs a shared outline vertex`);
  }
}
assert.equal(derivedRoomOwner.size, rooms.length, 'derived room ownership count mismatch');

const amphisCorrection = CAMPUS_CORRECTIONS['way/1203834931'];
assert(amphisCorrection, 'missing Amphis correction');
const amphis = campus.buildings.find((building) => building.id === 'way/1203834931');
assert(amphis, 'missing Amphis building in the catalog');
const amphisRooms = amphis.rooms;
const amphisEntrances = amphis.entrances;
const expectedAmphisEntrances = new Map<string, string>();
for (const [roomId, detail] of Object.entries(amphisCorrection.rooms)) {
  expectedAmphisEntrances.set(detail.entranceId, detail.side);
  const room = amphisRooms.find((candidate) => candidate.id === roomId);
  assert(room, `Amphis room ${roomId} missing from the catalog`);
  assert.equal(room.side, detail.side, `Amphis room ${roomId} side drift`);
  assert.equal(room.entranceId, detail.entranceId, `Amphis room ${roomId} entrance drift`);
}
assert.equal(amphisEntrances.length, expectedAmphisEntrances.size, 'Amphis associated entrance count mismatch');
for (const entrance of amphisEntrances) {
  assert(expectedAmphisEntrances.has(entrance.id), `unexpected Amphis entrance ${entrance.id}`);
  assert.equal(entrance.side, expectedAmphisEntrances.get(entrance.id), `Amphis entrance ${entrance.id} side drift`);
  assert.equal(entrance.association, 'user-correction', `Amphis entrance ${entrance.id} association drift`);
  // A documented room association does not establish opening hours or step-free access.
}

const origin: [number, number] = [campus.coordinates.origin.lng, campus.coordinates.origin.lat];
const checkGeoreference = (label: string, item: { lat: number; lng: number; position: { x: number; z: number } }) => {
  const [horizontal, vertical] = project([item.lng, item.lat], origin);
  const error = Math.hypot(horizontal - item.position.x, vertical - item.position.z);
  assert(error <= 0.03, `${label} georeferencing drift ${error.toFixed(3)} m`);
};
for (const building of campus.buildings) checkGeoreference(`building ${building.id}`, building);
for (const entrance of [...associated, ...campus.unassignedEntrances]) checkGeoreference(`entrance ${entrance.id}`, entrance);
assert.deepEqual(origin, geo.metadata.origin, 'catalogue/model geographic origins differ');

// --- Model node names and derived values ------------------------------------
const seenNodes = new Set<string>();
for (const building of campus.buildings) {
  const expectedNode = `building_${building.id.replace('/', '_')}`;
  assert.equal(building.modelNodeName, expectedNode, `${building.id} node name mismatch`);
  assert(!seenNodes.has(expectedNode), `duplicate model node ${expectedNode}`);
  seenNodes.add(expectedNode);

  const source = derivedById.get(building.id)!;
  assert(building.category === source.category, `${building.id} category drift`);
  assert(Math.abs(building.footprintArea - source.area) <= TOLERANCE, `${building.id} footprint area drift (${building.footprintArea} vs ${source.area})`);
  assert(building.floors === source.levels, `${building.id} floor count drift (${building.floors} vs ${source.levels})`);
  assert(Math.abs(building.height - source.height) <= TOLERANCE, `${building.id} height drift (${building.height} vs ${source.height})`);
  assert(Math.abs(building.position.x - source.center[0]) <= TOLERANCE, `${building.id} position.x drift`);
  assert(Math.abs(building.position.z - source.center[1]) <= TOLERANCE, `${building.id} position.z drift`);
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.readBinary(new Uint8Array(await readFile(modelPath)));
const modelNodes = new Map(document.getRoot().listNodes().filter((node) => node.getMesh()).map((node) => [node.getName(), node]));
for (const building of campus.buildings) {
  assert(modelNodes.has(building.modelNodeName), `model.glb is missing selectable node ${building.modelNodeName}`);
  assert.equal(modelNodes.get(building.modelNodeName)!.getExtras().buildingId, building.id, 'model node metadata points to a different building');
}

console.log(`campus.json verified: ${campus.buildings.length} buildings, ${rooms.length} rooms, ${associated.length} associated entrances, ${campus.unassignedEntrances.length} unassigned entrances, ${seenNodes.size} model nodes.`);
