import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CampusBuilding, ScheduledClass } from '../src/data/types';
import { prepareCampus, project, type CampusData, type Coordinate, type MapFeature, type Polygon } from '../src/lib/campus';
import { campusBuildings, searchCampusBuildings } from '../src/lib/campus-catalog';
import { COUR_ROUGE, courRougePosition, matchesCourRouge } from '../src/lib/campus-landmarks';
import { exactDestinationMatch, navigationDestinations, navigationUrl, searchDestinations } from '../src/lib/navigation-destinations';
import { findOfficialRoom, officialRooms, officialRoomScheduleUrl, officialRoomSource, searchOfficialRooms } from '../src/lib/official-rooms';
import { findMappedRoom } from '../src/lib/room-names';
import type { BuildingTag } from '../src/lib/building-tags';
import { calculateWalkingRoute, connectionIsClear, createWalkNetwork, pointDistance, projectOnSegment, routeInstructions, type WalkingRoute } from '../src/lib/walking-route';
import { formatLocationAccuracy, locationIssue, locationPoint, selectLocationFix } from '../src/lib/useLiveLocation';

const model = prepareCampus(JSON.parse(readFileSync(new URL('../public/data/campus.geojson', import.meta.url), 'utf8')) as CampusData);
const network = createWalkNetwork(model);
const destinations = navigationDestinations([], [], []);
const amphi = campusBuildings.find((building) => building.shortCode === 'AMPHI')!;
const courtyard = courRougePosition(model.data.metadata.origin);

function way(id: string, points: Coordinate[], tags: Record<string, string> = {}): MapFeature {
  return { type: 'Feature', id, geometry: { type: 'LineString', coordinates: points }, properties: { campus: true, kind: 'path', name: '', osmType: 'way', osmId: id, tags: { highway: 'footway', ...tags } } };
}
const square = (x: number, y: number, width: number, height: number): Polygon => [[[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]];
function sampleNetwork(features: MapFeature[]) { return createWalkNetwork({ ...model, features, boundary: square(-100, -100, 300, 300), campusBuildings: [] }); }
function sampleDestination(point: Coordinate) {
  const building: CampusBuilding = { ...amphi, id: 'test-building', entrances: [{ ...amphi.entrances[0], id: 'test-door', position: { x: point[0], z: point[1], y: 0 } }] };
  const destination = { ...destinations.find((entry) => entry.kind === 'building')!, buildingId: building.id, entranceId: 'test-door' };
  return { building, destination };
}
function ready(result: ReturnType<typeof calculateWalkingRoute>): WalkingRoute { assert(result.status === 'ready', `Expected a route, got ${result.status}`); return result.route; }

test('GPS uses exactly the base model projection, with east +X and north -Z', () => {
  const fix = { latitude: 35.7648, longitude: 10.80535, accuracy: 8, heading: null, timestamp: Date.now() };
  assert.deepEqual(locationPoint(fix), [0, 0]);
  assert(locationPoint({ ...fix, longitude: fix.longitude + .001 })[0] > 0);
  assert(locationPoint({ ...fix, latitude: fix.latitude + .001 })[1] < 0);
  assert.deepEqual(locationPoint({ ...fix, latitude: 35.7643203, longitude: 10.8050401 }), project([10.8050401, 35.7643203], model.data.metadata.origin));
});

test('room search ranks exact names and supports accents, compact codes and personal courses', () => {
  assert.equal(searchDestinations('Amphi 2', destinations)[0].title, 'Amphi 2');
  assert.equal(searchDestinations('amphi2', destinations)[0].title, 'Amphi 2');
  assert(searchDestinations('mathematiques', destinations).some((entry) => entry.title === 'Département de Mathématiques'));
  assert(searchDestinations('LC 1', destinations).some((entry) => entry.title === 'Locaux Communs 1'));
  const course: ScheduledClass = { id: 'my-course', buildingId: amphi.id, title: 'Analyse numérique', label: 'Mon TD', room: 'Amphi 5', catalogCode: null, floor: 1, days: [1], startTime: '08:00', endTime: '10:00' };
  const all = navigationDestinations([course, { ...course, id: 'missing-building', buildingId: 'missing' }], [{ id: 'tag', label: 'TP réseaux', buildingId: amphi.id, floor: 0, courseId: null, point: [-44, 17] }]);
  assert.equal(searchDestinations('analyse numerique', all)[0].id, 'course:my-course');
  assert.equal(searchDestinations('Mon TD', all)[0].entranceId, amphi.rooms.find((room) => room.name === 'Amphi 5')!.entranceId);
  assert.equal(searchDestinations('tp reseaux', all)[0].kind, 'tag');
  assert(!all.some((entry) => entry.id === 'course:missing-building'));
  assert.equal(searchDestinations('nonexistent-room-9876', all).length, 0);
  assert.equal(new Set(destinations.map((entry) => entry.id)).size, destinations.length);
});

test('Cour Rouge is an outdoor landmark and never a classroom or a course', () => {
  assert.equal(COUR_ROUGE.kind, 'courtyard');
  assert.equal(campusBuildings.some((building) => building.id === COUR_ROUGE.id || building.name === COUR_ROUGE.name), false);
  assert.equal(destinations.some((entry) => entry.title === COUR_ROUGE.name), false);
  assert.equal(searchDestinations('Cour Rouge', destinations).length, 0);
  assert(matchesCourRouge('courrouge'));
  assert(matchesCourRouge('Cour centrale'));
  assert.equal(matchesCourRouge('cours'), false);
  assert.equal(matchesCourRouge('Amphi 2'), false);
});

test('published amphitheatre abbreviations resolve existing rooms and preserve their doors', () => {
  for (let number = 1; number <= 6; number++) {
    const query = `A-${number}`;
    const destination = searchDestinations(query, destinations)[0];
    assert.equal(destination.title, `Amphi ${number}`);
    assert.equal(destinations.filter((entry) => exactDestinationMatch(query, entry)).length, 1);
    const room = findMappedRoom(amphi, query)!;
    assert.equal(destination.roomId, room.id);
    assert.equal(ready(calculateWalkingRoute(network, courtyard, destination, amphi)).entrance?.id, room.entranceId);
    assert.equal(searchCampusBuildings(`A${number}`)[0]?.id, amphi.id);
  }
  for (const letter of ['B', 'C']) {
    const matches = destinations.filter((entry) => exactDestinationMatch(`A-${letter}`, entry));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].title, `Amphi ${letter}`);
    assert.equal(matches[0].buildingId, 'relation/3375368');
  }
  const library = campusBuildings.find((building) => building.id === 'relation/3375369')!;
  assert.equal(findMappedRoom(library, 'BIB B1'), undefined, 'two same-name library rooms cannot be silently disambiguated');
});

test('the official room directory stays searchable without inventing physical locations', () => {
  assert.equal(officialRooms.length, 130);
  assert.equal(new Set(officialRooms.map((room) => room.id)).size, 130);
  assert(officialRoomSource.url.startsWith('https://www.fsm.rnu.tn/'));
  for (const name of ['INF.301', '101-M', '102 CH I', 'SALLE 6 CH II', 'BIB A3']) assert(findOfficialRoom(name));
  const informatics = searchOfficialRooms('INF301');
  assert.equal(informatics.length, 1);
  assert.equal(informatics[0].name, 'INF.301');
  assert(searchOfficialRooms('LABO ORG').length >= 2);
  assert.equal(searchOfficialRooms('unknown-room-9876').length, 0);
  assert.equal(searchDestinations('INF.301', destinations).length, 0, 'an official name alone cannot become a route endpoint');
  const link = new URL(officialRoomScheduleUrl(informatics[0]), 'https://fsm.example');
  assert.equal(link.pathname, '/schedule');
  assert.deepEqual([...link.searchParams], [['add', '1'], ['room', 'INF.301']], 'room suggestions must not choose a building or floor');
  assert.equal(destinations.filter((entry) => entry.kind === 'room' && entry.roomId).length, 31, 'the directory cannot create extra room footprints');
});

test('owner-published room pins become searchable routes and resolve personal courses without inventing rooms', () => {
  const pin: BuildingTag = { id: 'published-informatics', buildingId: amphi.id, label: 'INF.301', floor: 2, point: [-44, 17], courseId: null };
  const course: ScheduledClass = { id: 'published-course', buildingId: amphi.id, title: 'Informatique', label: '', room: 'INF301', catalogCode: null, floor: null, days: [1], startTime: '08:00', endTime: '10:00' };
  const source = JSON.stringify(model);
  const all = navigationDestinations([course], [], [pin]);
  const destination = all.find((entry) => entry.id === `location:${pin.id}`)!;
  assert.equal(searchDestinations('INF.301', all)[0].id, destination.id);
  assert.equal(destination.kind, 'room');
  assert.deepEqual(destination.tag?.point, pin.point);
  assert.deepEqual(destination.floors, [2]);
  assert.equal(destination.roomId, undefined);
  assert.equal(destination.entranceId, undefined);
  assert.equal(all.filter((entry) => entry.kind === 'room' && entry.roomId).length, 31);
  const personal = all.find((entry) => entry.id === 'course:published-course')!;
  assert.deepEqual(personal.tag, pin);
  assert.deepEqual(personal.floors, [2]);
  const route = ready(calculateWalkingRoute(network, courtyard, destination, amphi));
  assert(route.entrance ? amphi.entrances.some((entry) => entry.id === route.entrance?.id) : route.nearby);
  assert.equal(ready(calculateWalkingRoute(network, courtyard, personal, amphi)).entrance?.id, route.entrance?.id);
  assert.equal(JSON.stringify(model), source);
});

test('published amphitheatre pins preserve mapped IDs, front/rear doors and unconfirmed source floors', () => {
  const pin: BuildingTag = { id: 'published-amphi-five', buildingId: amphi.id, label: 'A-5', floor: 1, point: [-44, 17], courseId: null };
  const room = findMappedRoom(amphi, 'A-5')!;
  const all = navigationDestinations([], [], [pin]);
  const matches = all.filter((entry) => entry.tag?.id === pin.id);
  assert.equal(matches.length, 1, 'a published pin must not duplicate a known mapped room');
  assert.equal(matches[0].id, `room:${room.id}`);
  assert.equal(matches[0].entranceId, room.entranceId);
  assert.equal(matches[0].side, 'rear');
  assert.deepEqual(matches[0].floors, [1]);
  assert.equal(ready(calculateWalkingRoute(network, courtyard, matches[0], amphi)).entrance?.id, room.entranceId);
  const unknownFloor = navigationDestinations([], [], [{ ...pin, floor: null }]).find((entry) => entry.id === matches[0].id)!;
  assert.deepEqual(unknownFloor.floors, room.floors, 'an unspecified pin floor does not erase mapped levels');
  const draft = { ...pin, label: 'A-6', floor: 0 };
  const preview = navigationDestinations([], [draft], [pin]);
  assert.equal(preview.filter((entry) => entry.tag?.id === pin.id).length, 1);
  assert.equal(preview.find((entry) => entry.tag?.id === pin.id)?.roomId, findMappedRoom(amphi, 'A-6')!.id);
  assert.equal(preview.some((entry) => entry.id === `tag:${pin.id}`), false);
});

test('same-name published rooms stay separate and do not silently choose a course location', () => {
  const pin: BuildingTag = { id: 'published-duplicate', buildingId: amphi.id, label: 'Salle test', floor: 0, point: [-44, 17], courseId: null };
  const course: ScheduledClass = { id: 'ambiguous-course', buildingId: amphi.id, title: 'Test', label: '', room: pin.label, catalogCode: null, floor: null, days: [1], startTime: '08:00', endTime: '10:00' };
  const pins = [pin, { ...pin, id: 'published-duplicate-second', floor: 1 }];
  const all = navigationDestinations([course], [], pins);
  assert.equal(all.filter((entry) => entry.id.startsWith('location:')).length, 2);
  assert.equal(all.find((entry) => entry.id === 'course:ambiguous-course')?.tag, undefined);
  const knownFloor = navigationDestinations([{ ...course, floor: 1 }], [], pins).find((entry) => entry.id === 'course:ambiguous-course')!;
  assert.equal(knownFloor.tag?.id, pins[1].id);
});

test('all six amphitheatres route to their documented door and preserve front/rear attribution', () => {
  const source = JSON.stringify(amphi);
  for (const room of amphi.rooms) {
    const destination = destinations.find((entry) => entry.roomId === room.id)!;
    const route = ready(calculateWalkingRoute(network, courtyard, destination, amphi));
    assert.equal(route.entrance?.id, room.entranceId);
    assert.equal(destination.side, room.side);
    assert(route.distance > 15 && route.distance < 200);
    assert.equal(route.nearby, false);
    assert.equal(route.entrance?.verified, false, 'suggested routing must not turn map data into surveyed data');
  }
  assert.equal(JSON.stringify(amphi), source, 'routing does not mutate the catalog');
});

test('routes preserve every mapped segment, distance and path continuity', () => {
  for (const destination of destinations) {
    const building = campusBuildings.find((entry) => entry.id === destination.buildingId)!;
    const result = calculateWalkingRoute(network, courtyard, destination, building);
    if (result.status !== 'ready') continue;
    const { route } = result;
    assert(Math.abs(route.distance - route.legs.reduce((sum, leg) => sum + pointDistance(leg.from, leg.to), 0)) < .001);
    assert.equal(route.minutes, Math.max(1, Math.ceil(route.distance / 75)));
    for (let index = 0; index < route.legs.length; index++) {
      const leg = route.legs[index];
      if (index) assert(pointDistance(leg.from, route.legs[index - 1].to) < .03);
      if (leg.kind === 'path') assert(network.segments.some((segment) => segment.sourceId === leg.sourceId && projectOnSegment(leg.from, segment.a, segment.b).distance < .03 && projectOnSegment(leg.to, segment.a, segment.b).distance < .03));
      else assert(connectionIsClear(network, leg.from, leg.to), 'estimated connections cannot cross obstacles');
    }
  }
});

test('virtual points on the same segment do not detour through its endpoints', () => {
  const graph = sampleNetwork([way('straight', [[0, 0], [100, 0]])]);
  const { building, destination } = sampleDestination([8, 0]);
  assert.equal(ready(calculateWalkingRoute(graph, [3, 0], destination, building)).distance, 5);
  assert.equal(ready(calculateWalkingRoute(graph, [15, 0], destination, building)).distance, 7);
  assert.equal(ready(calculateWalkingRoute(graph, [8, 0], destination, building)).distance, 0);
});

test('routing chooses the shortest mapped route, including reverse walking', () => {
  const graph = sampleNetwork([way('detour', [[0, 0], [0, 20], [20, 20], [20, 0]]), way('direct', [[0, 0], [20, 0]])]);
  const { building, destination } = sampleDestination([18, 0]);
  const route = ready(calculateWalkingRoute(graph, [1, 0], destination, building));
  assert.equal(route.distance, 17);
  assert(route.legs.every((leg) => leg.sourceId === 'direct'));
});

test('nearby disconnected paths are not bridged, even when a destination is close', () => {
  const graph = sampleNetwork([way('first', [[0, 0], [10, 0]]), way('second', [[0, 10], [10, 10]])]);
  const { building, destination } = sampleDestination([0, 10]);
  assert.equal(calculateWalkingRoute(graph, [0, 0], destination, building).status, 'disconnected');
});

test('crossings require a mapped vertex, and different layers do not become junctions', () => {
  const { building, destination } = sampleDestination([10, 0]);
  const crossing = sampleNetwork([way('first', [[0, 0], [10, 10]]), way('second', [[0, 10], [10, 0]])]);
  assert.equal(calculateWalkingRoute(crossing, [0, 0], destination, building).status, 'disconnected');
  const junction = sampleNetwork([way('first', [[0, 0], [10, 10]]), way('second', [[0, 10], [5, 5], [10, 0]])]);
  assert.equal(calculateWalkingRoute(junction, [0, 0], destination, building).status, 'ready');
  const bridge = sampleNetwork([way('first', [[0, 0], [10, 10]]), way('second', [[0, 10], [5, 5], [10, 0]], { bridge: 'yes', layer: '1' })]);
  assert.equal(calculateWalkingRoute(bridge, [0, 0], destination, building).status, 'disconnected');
});

test('private, forbidden and indoor ways are excluded', () => {
  const graph = sampleNetwork([way('public', [[0, 0], [10, 0]]), way('private', [[10, 0], [20, 0]], { access: 'private' }), way('no-foot', [[10, 0], [30, 0]], { foot: 'no' }), way('indoor', [[10, 0], [40, 0]], { indoor: 'yes' })]);
  assert.deepEqual([...new Set(graph.segments.map((segment) => segment.sourceId))], ['public']);
});

test('connections do not cross buildings, thin obstacles or walls and respect courtyard holes', () => {
  const graph = sampleNetwork([way('path', [[-10, 0], [10, 0]])]);
  graph.obstacles = [square(-.1, .9, .2, .2)];
  assert.equal(connectionIsClear(graph, [0, 2], [0, 0]), false);
  graph.obstacles = [[...square(-5, -5, 10, 10), square(-2, -2, 4, 4)[0]]];
  assert.equal(connectionIsClear(graph, [-1, 0], [1, 0]), true);
  assert.equal(connectionIsClear(graph, [-3, 0], [1, 0]), false);
  graph.obstacles = [];
  graph.walls = [[[-5, 1], [5, 1]]];
  assert.equal(connectionIsClear(graph, [0, 2], [0, 0]), false);
});

test('remote, invalid and obstructed starts never receive a straight-line fallback', () => {
  const destination = destinations.find((entry) => entry.title === 'Amphi 1')!;
  assert.equal(calculateWalkingRoute(network, [5000, 5000], destination, amphi).status, 'outside');
  assert.equal(calculateWalkingRoute(network, [NaN, 0], destination, amphi).status, 'outside');
  const graph = sampleNetwork([way('first', [[0, 0], [10, 0]])]);
  graph.obstacles = [square(-5, -5, 20, 20)];
  const target = sampleDestination([10, 0]);
  assert.equal(calculateWalkingRoute(graph, [0, 0], target.destination, target.building).status, 'off-path');
});

test('missing and forbidden entrances do not silently substitute another room’s door', () => {
  const destination = { ...destinations.find((entry) => entry.title === 'Amphi 1')!, entranceId: 'missing-door' };
  assert.equal(calculateWalkingRoute(network, courtyard, destination, amphi).status, 'no-access');
  const closed = { ...amphi, entrances: amphi.entrances.map((entrance) => ({ ...entrance, access: 'no' })) };
  assert.equal(calculateWalkingRoute(network, courtyard, { ...destination, entranceId: undefined }, closed).status, 'no-access');
});

test('unmapped entrances end on a nearby mapped path without claiming a door', () => {
  const destination = destinations.find((entry) => entry.title === 'Bâtiment 17')!;
  const building = campusBuildings.find((entry) => entry.id === destination.buildingId)!;
  const route = ready(calculateWalkingRoute(network, courtyard, destination, building));
  assert.equal(route.entrance, null);
  assert.equal(route.nearby, true);
  assert(network.segments.some((segment) => projectOnSegment(route.endpoint, segment.a, segment.b).distance < .03));
});

test('turn instructions follow the model’s north axis and preserve their total distance', () => {
  const graph = sampleNetwork([way('turns', [[0, 10], [0, 0], [10, 0], [10, -10]])]);
  const { building, destination } = sampleDestination([10, -10]);
  const route = ready(calculateWalkingRoute(graph, [0, 10], destination, building));
  const instructions = routeInstructions(route);
  assert.deepEqual(instructions.map((entry) => entry.kind), ['straight', 'right', 'left']);
  assert(instructions[0].text.includes('nord'));
  assert.equal(instructions.reduce((sum, entry) => sum + entry.distance, 0), route.distance);
});

test('stale, inaccurate and malformed fixes cannot start guidance', () => {
  const now = Date.now();
  const fix = { latitude: 35.7648, longitude: 10.80535, accuracy: 8, heading: null, timestamp: now };
  assert.equal(locationIssue(fix, now), null);
  assert.match(locationIssue({ ...fix, accuracy: 200 }, now)!, /imprécise/);
  assert.match(locationIssue({ ...fix, timestamp: now - 31_000 }, now)!, /plus à jour/);
  assert.match(locationIssue({ ...fix, latitude: 200 }, now)!, /invalide/);
  assert.match(locationIssue({ ...fix, accuracy: -1 }, now)!, /invalide/);
  assert.match(locationIssue({ ...fix, timestamp: now + 60_000 }, now)!, /invalide/);
});

test('fresh precise GPS survives coarse or out-of-order updates and follows new precise fixes', () => {
  const now = Date.now();
  const precise = { latitude: 35.7643203, longitude: 10.8050401, accuracy: 8, heading: null, timestamp: now };
  const coarse = { ...precise, accuracy: 77413, timestamp: now + 1000 };
  assert.equal(selectLocationFix(precise, coarse, now + 1000), precise);
  const walked = { ...precise, latitude: 35.7644, accuracy: 14, timestamp: now + 2000 };
  assert.equal(selectLocationFix(precise, walked, now + 2000), walked);
  assert.equal(selectLocationFix(walked, precise, now + 2000), walked);
  assert.equal(selectLocationFix(precise, { ...coarse, accuracy: NaN }, now + 1000), precise);
  assert.equal(selectLocationFix(null, { ...coarse, accuracy: -1 }, now + 1000), null);
  assert.equal(selectLocationFix(precise, { ...coarse, latitude: 200 }, now + 1000), precise);
});

test('GPS refinement improves coarse estimates but never extends a precise fix past its expiry', () => {
  const now = Date.now();
  const coarse = { latitude: 35.7643203, longitude: 10.8050401, accuracy: 77413, heading: null, timestamp: now };
  const improved = { ...coarse, accuracy: 200, timestamp: now + 1000 };
  assert.equal(selectLocationFix(coarse, improved, now + 1000), improved);
  assert(locationIssue(improved, now + 1000));
  assert.equal(selectLocationFix(improved, coarse, now + 1000), improved);
  const precise = { ...coarse, accuracy: 8 };
  const laterCoarse = { ...coarse, timestamp: now + 31_000 };
  assert.equal(selectLocationFix(precise, laterCoarse, now + 31_000), laterCoarse);
  assert(locationIssue(laterCoarse, now + 31_000), 'an expired precise location cannot authorize routing');
  assert.equal(selectLocationFix(null, precise, now + 31_000), null);
});

test('a city-scale accuracy estimate has a readable phone message', () => {
  assert.equal(formatLocationAccuracy(77413), '77 km');
  assert.equal(formatLocationAccuracy(200), '200 m');
  const fix = { latitude: 35.7643203, longitude: 10.8050401, accuracy: 77413, heading: null, timestamp: Date.now() };
  assert.match(locationIssue(fix)!, /±77 km.*position précise/);
  assert.match(locationIssue(fix, fix.timestamp + 31_000)!, /±77 km.*position précise/);
});

test('navigation links contain only the destination and do not leak a position', () => {
  const url = new URL(navigationUrl('course:my / course'), 'https://example.test');
  assert.equal(url.pathname, '/map');
  assert.deepEqual([...url.searchParams], [['navigate', '1'], ['destination', 'course:my / course']]);
});
