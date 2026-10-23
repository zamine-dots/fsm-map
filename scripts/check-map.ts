import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Mesh } from 'three';
import {
  BUILDING_TAGS_KEY, MAX_BUILDING_TAGS, interiorPoint, parseBuildingTag,
  parseBuildingTagsBackup, pointInFootprint, serializeBuildingTags, type BuildingTag,
} from '../src/lib/building-tags';
import { createBuildingTagStore } from '../src/store/useBuildingTags';
import { boundsOf, insidePolygon, polygonArea, polygonsOf, prepareCampus, type CampusData, type Coordinate, type Polygon } from '../src/lib/campus';
import { COUR_ROUGE, courRougePavingJoints, courRougePolygon, courRougePosition, courRougeReference } from '../src/lib/campus-landmarks';
import { CampusScene, disposeGroup } from '../src/lib/campus-scene';
import { isLoopbackHost, LOCAL_ROOM_API, mayEditCampus } from '../src/lib/campus-editing';
import { publishedRoomData } from '../src/lib/published-room-locations';
import { parseRoomLocations, roomLocationsFromTags, validateRoomLocationGeometry } from '../src/lib/room-locations-format';
import { localRoomMiddleware } from './local-campus-editor';

const tag: BuildingTag = { id: 'map-test-tag', buildingId: 'way/1203834931', label: 'TP de physique', floor: 0, point: [-44, 17], courseId: 'personal-course' };
const backup = serializeBuildingTags([tag]);
function memoryStorage(raw: string | null = null) {
  const values = new Map<string, string>([['fsm-navigator-schedule-v1', 'unchanged schedule'], ['fsm-building-edits-v1', 'unchanged corrections']]);
  if (raw !== null) values.set(BUILDING_TAGS_KEY, raw);
  let failure: 'read' | 'write' | null = null;
  return {
    values,
    fail: (value: typeof failure) => { failure = value; },
    getItem: (key: string) => { if (failure === 'read') throw new Error('Denied'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (failure) throw new Error('Quota'); values.set(key, value); },
  };
}

test('campus editing requires a loopback development address, including production previews', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert(isLoopbackHost(host));
    assert(mayEditCampus(true, host));
    assert.equal(mayEditCampus(false, host), false);
  }
  for (const host of ['fsm-map.vercel.app', '192.168.1.2', 'localhost.example.com', '127.0.0.1.example.com', '']) {
    assert.equal(mayEditCampus(true, host), false);
    assert.equal(mayEditCampus(false, host), false);
  }
});

test('readonly tag stores ignore old browser pins and reject every edit without accessing storage', () => {
  const shared = { ...tag, courseId: null };
  for (const original of [backup, '{broken tags']) {
    const storage = memoryStorage(original);
    let reads = 0;
    let writes = 0;
    const store = createBuildingTagStore({
      getItem: (key) => { reads++; return storage.getItem(key); },
      setItem: (key, value) => { writes++; storage.setItem(key, value); },
    }, { editable: false, initialTags: [shared] });
    assert.deepEqual(store.getState().tags, [shared]);
    for (const mutate of [
      () => store.getState().saveTag(tag), () => store.getState().deleteTag(shared),
      () => store.getState().retry(), () => store.getState().retry(true), () => store.getState().replaceTags([]),
    ]) assert.throws(mutate, /uniquement en local/);
    store.getState().reload();
    assert.equal(store.getState().status, 'ready');
    assert.deepEqual(store.getState().tags, [shared]);
    assert.equal(reads + writes, 0);
    assert.equal(storage.getItem(BUILDING_TAGS_KEY), original);
  }
});

test('local editors start with published rooms and retain an existing draft or unavailable-storage seed', () => {
  const shared = { ...tag, courseId: null };
  const storage = memoryStorage();
  const store = createBuildingTagStore(storage, { initialTags: [shared] });
  assert.deepEqual(store.getState().tags, [shared]);
  assert.equal(storage.getItem(BUILDING_TAGS_KEY), null, 'opening the editor must not write a draft');
  const additional = { ...shared, id: 'new-local-room' };
  store.getState().saveTag(additional);
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), [shared, additional]);
  assert.deepEqual(createBuildingTagStore(memoryStorage(backup), { initialTags: [shared] }).getState().tags, [tag]);
  assert.deepEqual(createBuildingTagStore(null, { initialTags: [shared] }).getState().tags, [shared]);
});

test('tag backups preserve floor, model position, course links and unknown buildings', () => {
  assert.deepEqual(parseBuildingTagsBackup(backup), [tag]);
  const unknown = { ...tag, buildingId: 'former-building', floor: null, courseId: null };
  assert.deepEqual(parseBuildingTagsBackup(serializeBuildingTags([unknown])), [unknown]);
  assert.equal(parseBuildingTag({ ...tag, label: '  Salle 12  ' }).label, 'Salle 12');
  assert.equal(parseBuildingTag({ ...tag, floor: -2 }).floor, -2);
});

test('invalid tags and wrong backup formats cannot replace saved annotations', () => {
  for (const value of [
    null, [], { ...tag, label: '' }, { ...tag, label: 'x'.repeat(101) }, { ...tag, label: '\u0000' },
    { ...tag, floor: 1.5 }, { ...tag, floor: '0' }, { ...tag, floor: undefined }, { ...tag, floor: 201 },
    { ...tag, point: [NaN, 1] }, { ...tag, point: [0, Infinity] }, { ...tag, point: [2001, 0] },
    { ...tag, point: [0] }, { ...tag, point: ['1', 0] }, { ...tag, courseId: '' },
  ]) assert.throws(() => parseBuildingTag(value));
  assert.throws(() => parseBuildingTagsBackup('{broken'));
  assert.throws(() => parseBuildingTagsBackup(backup.replace('fsm-building-tags', 'fsm-navigator-schedule')));
  assert.throws(() => parseBuildingTagsBackup(backup.replace('fsm-campus', 'other-campus')));
  assert.throws(() => parseBuildingTagsBackup(backup.replace('local-metres', 'WGS84')));
  assert.throws(() => parseBuildingTagsBackup('é'.repeat(530_000)), /dépasse/);
  const storage = memoryStorage(backup);
  const store = createBuildingTagStore(storage);
  assert.throws(() => store.getState().replaceTags([tag, tag]), /identifiant/);
  assert.equal(storage.getItem(BUILDING_TAGS_KEY), backup);
  assert.deepEqual(store.getState().tags, [tag]);
});

test('tag limits reject an extra entry without changing memory or storage', () => {
  const maximum = Array.from({ length: MAX_BUILDING_TAGS }, (_, index) => ({ ...tag, id: `tag-${index}` }));
  const storage = memoryStorage(serializeBuildingTags(maximum));
  const store = createBuildingTagStore(storage);
  const before = storage.getItem(BUILDING_TAGS_KEY);
  assert.throws(() => store.getState().saveTag(tag), /Maximum/);
  assert.equal(storage.getItem(BUILDING_TAGS_KEY), before);
  assert.equal(store.getState().tags.length, MAX_BUILDING_TAGS);
});

test('creating, editing and deleting a tag leaves schedules and corrections intact', () => {
  const storage = memoryStorage();
  const store = createBuildingTagStore(storage);
  store.getState().saveTag(tag);
  const edited = { ...tag, label: 'Salle 12', point: [-45, 18] as Coordinate, floor: null };
  store.getState().saveTag(edited, tag);
  assert.deepEqual(createBuildingTagStore(storage).getState().tags, [edited]);
  assert.throws(() => store.getState().saveTag({ ...edited, id: 'different' }, edited), /bâtiment d’origine/);
  assert.throws(() => store.getState().saveTag({ ...edited, buildingId: 'different' }, edited), /bâtiment d’origine/);
  assert.throws(() => store.getState().deleteTag(tag), /changé/);
  store.getState().deleteTag(edited);
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), []);
  assert.equal(storage.values.get('fsm-navigator-schedule-v1'), 'unchanged schedule');
  assert.equal(storage.values.get('fsm-building-edits-v1'), 'unchanged corrections');
});

for (const failure of ['read', 'write'] as const) test(`${failure} failures keep tag edits exportable until a successful retry`, () => {
  const storage = memoryStorage();
  const store = createBuildingTagStore(storage);
  storage.fail(failure);
  store.getState().saveTag(tag);
  assert.equal(store.getState().status, 'unavailable');
  assert.equal(store.getState().dirty, true);
  assert.deepEqual(parseBuildingTagsBackup(serializeBuildingTags(store.getState().tags)), [tag]);
  assert.equal(storage.values.get(BUILDING_TAGS_KEY), undefined);
  storage.fail(null);
  store.getState().retry();
  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().status, 'ready');
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), [tag]);
});

test('an unreadable original survives edits and retries until explicit replacement', () => {
  const original = '{unreadable original';
  const storage = memoryStorage(original);
  const store = createBuildingTagStore(storage);
  store.getState().saveTag(tag);
  store.getState().retry();
  store.getState().reload();
  assert.equal(storage.getItem(BUILDING_TAGS_KEY), original);
  assert.equal(store.getState().originalRaw, original);
  assert.deepEqual(store.getState().tags, [tag]);
  store.getState().retry(true);
  assert.equal(store.getState().status, 'ready');
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), [tag]);
});

test('cross-tab reload rejects stale edits and preserves conflicts for explicit recovery', () => {
  const storage = memoryStorage(backup);
  const first = createBuildingTagStore(storage);
  const second = createBuildingTagStore(storage);
  const remote = { ...tag, label: 'Autre onglet' };
  first.getState().saveTag(remote, tag);
  second.getState().reload();
  assert.deepEqual(second.getState().tags, [remote]);
  assert.throws(() => second.getState().saveTag(tag, tag), /changé/);
  assert.throws(() => second.getState().deleteTag(tag), /changé/);
  const later = { ...remote, label: 'Copie plus récente' };
  first.getState().saveTag(later, remote);
  const unsaved = { ...tag, id: 'unsaved', label: 'Mon brouillon' };
  second.getState().saveTag(unsaved);
  assert.equal(second.getState().status, 'conflict');
  assert.deepEqual(second.getState().tags, [remote, unsaved]);
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), [later]);
  second.getState().reload();
  second.getState().retry();
  assert.deepEqual(parseBuildingTagsBackup(storage.getItem(BUILDING_TAGS_KEY)!), [later]);
  second.getState().retry(true);
  assert.deepEqual(createBuildingTagStore(storage).getState().tags, [remote, unsaved]);
});

test('an initially denied read cannot overwrite tags that become readable later', () => {
  const storage = memoryStorage(backup);
  storage.fail('read');
  const store = createBuildingTagStore(storage);
  store.getState().saveTag({ ...tag, id: 'unsaved' });
  storage.fail(null);
  store.getState().retry();
  assert.equal(store.getState().status, 'conflict');
  assert.equal(storage.getItem(BUILDING_TAGS_KEY), backup);
});

const geo = JSON.parse(readFileSync('public/data/campus.geojson', 'utf8')) as CampusData;
const model = prepareCampus(geo);

test('the shared room snapshot has valid names, levels and placements inside real campus buildings', () => {
  assert.deepEqual(parseRoomLocations(JSON.parse(readFileSync('src/data/room-locations.json', 'utf8'))), publishedRoomData);
  validateRoomLocationGeometry(publishedRoomData, model.campusBuildings);
});

test('shared room exports exclude course data and reject invalid or ambiguous placements', () => {
  const data = roomLocationsFromTags([tag], null);
  assert.deepEqual(data.locations, [{ id: tag.id, buildingId: tag.buildingId, name: tag.label, floor: tag.floor, point: tag.point }]);
  assert.equal(JSON.stringify(data).includes('personal-course'), false);
  validateRoomLocationGeometry(data, model.campusBuildings);
  for (const room of [
    { ...data.locations[0], courseId: tag.courseId }, { ...data.locations[0], name: '' },
    { ...data.locations[0], floor: 1.5 }, { ...data.locations[0], point: [NaN, 0] },
  ]) assert.throws(() => parseRoomLocations({ ...data, locations: [room] }));
  assert.throws(() => parseRoomLocations({ ...data, locations: [data.locations[0], data.locations[0]] }), /identifiant/);
  assert.throws(() => parseRoomLocations({ ...data, updatedAt: 'not a date' }), /Date/);
  assert.throws(() => parseRoomLocations({ ...data, coordinates: 'WGS84' }), /Format/);
  assert.throws(() => parseRoomLocations({ ...data, locations: Array.from({ length: 501 }, (_, i) => ({ ...data.locations[0], id: `room-${i}` })) }), /Maximum/);
  assert.throws(() => validateRoomLocationGeometry({ ...data, locations: [{ ...data.locations[0], buildingId: 'unknown-building' }] }, model.campusBuildings), /inconnu/);
  assert.throws(() => validateRoomLocationGeometry({ ...data, locations: [{ ...data.locations[0], point: [1000, 1000] }] }, model.campusBuildings), /dans son bâtiment/);
  const polygon: Polygon = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]];
  assert.throws(() => validateRoomLocationGeometry({ ...data, locations: [{ ...data.locations[0], point: [5, 5] }] }, [{ id: tag.buildingId, polygons: [polygon] }]), /cours ouvertes/);
});

type LocalRequestOptions = { headers?: Record<string, string | undefined>; address?: string; method?: string; url?: string; raw?: string };
async function localRequest(middleware: ReturnType<typeof localRoomMiddleware>, value: unknown, options: LocalRequestOptions = {}) {
  const request = Object.assign(Readable.from([Buffer.from(options.raw ?? JSON.stringify(value))]), {
    url: options.url ?? LOCAL_ROOM_API, method: options.method ?? 'POST', socket: { remoteAddress: options.address ?? '127.0.0.1' },
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-fsm-local-editor': '1', ...options.headers },
  });
  const result = { status: 0, body: {} as { saved?: boolean; count?: number; updatedAt?: string; error?: string }, next: false };
  const response = {
    writeHead: (status: number) => { result.status = status; },
    end: (body: string) => { result.body = JSON.parse(body); },
  };
  try { await middleware(request as unknown as IncomingMessage, response as unknown as ServerResponse, () => { result.next = true; }); }
  finally { request.destroy(); }
  return result;
}

test('local project saves write only validated room data atomically and reject stale revisions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fsm-local-room-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json');
  await writeFile(file, JSON.stringify(roomLocationsFromTags([], null)));
  const middleware = localRoomMiddleware(file, model);
  const data = roomLocationsFromTags([tag], null);
  const result = await localRequest(middleware, data);
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, true);
  assert.equal(result.body.count, 1);
  assert(Number.isFinite(Date.parse(result.body.updatedAt!)));
  const saved = await readFile(file, 'utf8');
  assert.deepEqual(parseRoomLocations(JSON.parse(saved)), { ...data, updatedAt: result.body.updatedAt });
  assert.equal((await localRequest(middleware, roomLocationsFromTags([], null))).status, 409);
  assert.equal(await readFile(file, 'utf8'), saved);
  assert.deepEqual(await readdir(directory), ['rooms.json'], 'no partial write or temporary file remains');
  assert.equal((await localRequest(middleware, data, { url: '/map' })).next, true);
});

test('the local save endpoint rejects remote origins, missing protection and invalid data without writing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fsm-local-room-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json');
  const data = roomLocationsFromTags([tag], null);
  const original = JSON.stringify(roomLocationsFromTags([], null));
  await writeFile(file, original);
  const middleware = localRoomMiddleware(file, model);
  const invalidRequests: [LocalRequestOptions, number][] = [
    [{ headers: { origin: 'https://fsm-map.vercel.app' } }, 403], [{ headers: { origin: undefined } }, 403],
    [{ headers: { origin: 'http://localhost:3001' } }, 403], [{ headers: { origin: 'https://localhost:3000' } }, 403],
    [{ headers: { host: 'localhost.example.com:3000' } }, 403], [{ address: '192.168.1.20' }, 403],
    [{ headers: { 'x-fsm-local-editor': undefined } }, 403], [{ method: 'GET' }, 405],
    [{ headers: { 'content-type': 'text/plain' } }, 415], [{ raw: '{broken' }, 400],
    [{ raw: ' '.repeat(1_048_577) }, 413],
  ];
  for (const [options, status] of invalidRequests) assert.equal((await localRequest(middleware, data, options)).status, status, JSON.stringify(options.headers ?? options.method ?? options.address ?? status));
  assert.equal((await localRequest(middleware, { ...data, locations: [{ ...data.locations[0], point: [1000, 1000] }] })).status, 400);
  assert.equal((await localRequest(middleware, { ...data, locations: [{ ...data.locations[0], courseId: 'private-course' }] })).status, 400);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('simultaneous local saves cannot overwrite one another, even within one millisecond', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fsm-local-room-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json');
  const updatedAt = new Date(Date.now() + 60_000).toISOString();
  await writeFile(file, JSON.stringify(roomLocationsFromTags([], updatedAt)));
  const middleware = localRoomMiddleware(file, model);
  const requests = [roomLocationsFromTags([tag], updatedAt), roomLocationsFromTags([], updatedAt)];
  const results = await Promise.all(requests.map((data) => localRequest(middleware, data)));
  assert.deepEqual(results.map((result) => result.status), [200, 409]);
  const saved = parseRoomLocations(JSON.parse(await readFile(file, 'utf8')));
  assert(Date.parse(saved.updatedAt!) > Date.parse(updatedAt));
  assert.deepEqual(saved.locations, requests[0].locations);
  assert.deepEqual(await readdir(directory), ['rooms.json']);
});

test('tag placement excludes open courtyard holes and finds a real interior point for every building', () => {
  const footprint: Polygon = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]];
  assert.equal(pointInFootprint([5, 5], [footprint]), false);
  assert.equal(pointInFootprint([1, 1], [footprint]), true);
  assert.equal(pointInFootprint([15, 15], [footprint]), false);
  assert(pointInFootprint(interiorPoint([footprint])!, [footprint]));
  for (const building of model.campusBuildings) {
    const point = interiorPoint(building.polygons);
    assert(point && pointInFootprint(point, building.polygons), building.name);
  }
});

test('Cour Rouge covers the central surface while preserving gardens and building footprints', () => {
  const polygon = courRougePolygon(geo.metadata.origin);
  assert(insidePolygon(courRougePosition(geo.metadata.origin), polygon));
  assert(polygonArea(polygon) > 2_000 && polygonArea(polygon) < 2_200, 'courtyard must be a surface, not a marker disk');
  assert.equal(polygon.length, 4, 'three garden islands are excluded');
  const bounds = boundsOf(polygon[0]);
  const obstacles = model.features.filter((feature) => ['building', 'garden'].includes(feature.properties.kind)).flatMap((feature) => polygonsOf(feature.geometry));
  for (let x = bounds.minX; x < bounds.maxX; x += 0.75) for (let z = bounds.minZ; z < bounds.maxZ; z += 0.75) {
    const point: Coordinate = [x, z];
    if (insidePolygon(point, polygon)) {
      assert(insidePolygon(point, model.boundary), 'courtyard cannot leave the campus');
      assert(!obstacles.some((obstacle) => insidePolygon(point, obstacle)), 'courtyard cannot cover a building or garden');
    }
  }
  const joints = courRougePavingJoints(geo.metadata.origin);
  assert(joints.length > 10, 'the courtyard has the paving grid visible in the reference image');
  for (const [a, b] of joints) for (const t of [.01, .25, .5, .75, .99]) {
    const point: Coordinate = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    assert(insidePolygon(point, polygon), 'paving joints must stop at gardens and courtyard edges');
  }
});

test('Cour Rouge mesh keeps its courtyard classification, shared paving and geographic alignment', () => {
  const scene = new CampusScene(model);
  try {
    const mesh = scene.modelRoot.getObjectByName(COUR_ROUGE.modelNodeName);
    assert(mesh instanceof Mesh);
    assert.equal(mesh.material.color.getHexString(), COUR_ROUGE.color.slice(1));
    assert.equal(mesh.userData.landmarkId, COUR_ROUGE.id);
    assert.equal(mesh.userData.placeKind, 'courtyard');
    assert.equal(mesh.userData.buildingId, undefined);
    assert(scene.modelRoot.getObjectByName('landmark_cour_rouge_paving'), 'the GLB includes the same paving grid as the 2D maps');
    const index = mesh.geometry.getIndex()!;
    const positions = mesh.geometry.getAttribute('position');
    let area = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      area += Math.abs((positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a)) - (positions.getZ(b) - positions.getZ(a)) * (positions.getX(c) - positions.getX(a))) / 2;
    }
    assert(Math.abs(area - polygonArea(courRougePolygon(geo.metadata.origin))) < 0.01, 'triangulation must preserve garden cutouts');
    const [x, z] = courRougePosition(geo.metadata.origin);
    assert.deepEqual(courRougeReference([x, z + 10], geo.metadata.origin), { distance: 10, bearing: 0, direction: 'au nord' });
    assert.deepEqual(courRougeReference([x + 10, z], geo.metadata.origin), { distance: 10, bearing: 270, direction: 'à l’ouest' });
  } finally { disposeGroup(scene.modelRoot); }
});
