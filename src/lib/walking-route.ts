import type { CampusBuilding, CampusEntrance } from '../data/types';
import { distanceToSegment, insidePolygon, polygonsOf, type CampusModel, type Coordinate, type MapFeature, type Polygon } from './campus';
import type { NavigationDestination } from './navigation-destinations';

export interface WalkSegment {
  id: string;
  from: string;
  to: string;
  a: Coordinate;
  b: Coordinate;
  sourceId: string;
  name: string;
  stairs: boolean;
}
export interface WalkNetwork {
  nodes: Map<string, Coordinate>;
  segments: WalkSegment[];
  model: CampusModel;
  obstacles: Polygon[];
  walls: Coordinate[][];
}
export interface RouteLeg {
  from: Coordinate;
  to: Coordinate;
  distance: number;
  kind: 'path' | 'connection';
  name: string;
  sourceId?: string;
  stairs: boolean;
}
export interface WalkingRoute {
  legs: RouteLeg[];
  points: Coordinate[];
  distance: number;
  minutes: number;
  entrance: CampusEntrance | null;
  endpoint: Coordinate;
  nearby: boolean;
  destinationId: string;
}
export type RouteResult = { status: 'ready'; route: WalkingRoute } | { status: 'outside' | 'off-path' | 'no-access' | 'disconnected'; message: string };
interface Snap { segment: WalkSegment; point: Coordinate; t: number; distance: number }
interface Arc { to: string; leg: RouteLeg }

export const pointDistance = (a: Coordinate, b: Coordinate) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const interpolate = (a: Coordinate, b: Coordinate, t: number): Coordinate => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cross = (a: Coordinate, b: Coordinate) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Coordinate, b: Coordinate): Coordinate => [a[0] - b[0], a[1] - b[1]];

export function projectOnSegment(point: Coordinate, a: Coordinate, b: Coordinate) {
  const delta = subtract(b, a);
  const length = delta[0] ** 2 + delta[1] ** 2;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * delta[0] + (point[1] - a[1]) * delta[1]) / length)) : 0;
  const projected = interpolate(a, b, t);
  return { point: projected, t, distance: pointDistance(point, projected) };
}

function intersection(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): number | null {
  const ab = subtract(b, a), cd = subtract(d, c), ac = subtract(c, a);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Test every interval between boundary crossings, including holes and thin obstacles. */
function cutsPolygon(a: Coordinate, b: Coordinate, polygon: Polygon): boolean {
  const crossings = [0, 1];
  for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
    const t = intersection(a, b, ring[index - 1], ring[index]);
    if (t !== null) crossings.push(t);
  }
  crossings.sort((x, y) => x - y);
  for (let index = 1; index < crossings.length; index++) {
    const middle = interpolate(a, b, (crossings[index - 1] + crossings[index]) / 2);
    // Catalog positions are rounded to 0.1 mm; allow boundary noise, not a path through a footprint.
    if (insidePolygon(middle, polygon) && !polygon.some((ring) => ring.some((p, i) => i > 0 && distanceToSegment(middle, ring[i - 1], p) < 0.06))) return true;
  }
  return false;
}

export function connectionIsClear(network: WalkNetwork, a: Coordinate, b: Coordinate): boolean {
  if (network.obstacles.some((polygon) => cutsPolygon(a, b, polygon))) return false;
  return !network.walls.some((wall) => wall.some((point, index) => {
    if (!index) return false;
    const t = intersection(a, b, wall[index - 1], point);
    return t !== null && t > 0.001 && t < 0.999;
  }));
}

const allowed = (feature: MapFeature) => {
  const { tags, kind, campus } = feature.properties;
  const restriction = tags.foot ?? tags.access;
  return campus && (kind === 'path' || kind === 'road' && ['service', 'living_street', 'pedestrian'].includes(tags.highway)) &&
    feature.geometry.type === 'LineString' && !['no', 'private', 'customers', 'delivery'].includes(restriction) &&
    tags.indoor !== 'yes' && (!tags.level || tags.level === '0') && tags.area !== 'yes';
};

/** Build only from mapped outdoor ways. Nearby disconnected ways are never bridged. */
export function createWalkNetwork(model: CampusModel): WalkNetwork {
  const nodes = new Map<string, Coordinate>();
  const segments: WalkSegment[] = [];
  const obstacles = model.features.filter((feature) => feature.properties.kind === 'garden' || feature.properties.kind === 'building' && feature.properties.tags.building !== 'roof').flatMap((feature) => polygonsOf(feature.geometry));
  const walls = model.features.filter((feature) => feature.properties.kind === 'wall').flatMap((feature) => feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : []);
  for (const feature of model.features.filter(allowed)) {
    if (feature.geometry.type !== 'LineString') continue;
    const layer = `${feature.properties.tags.layer ?? '0'}:${feature.properties.tags.bridge ?? 'no'}:${feature.properties.tags.tunnel ?? 'no'}`;
    const idFor = (point: Coordinate) => `${point[0].toFixed(3)},${point[1].toFixed(3)}:${layer}`;
    for (let index = 1; index < feature.geometry.coordinates.length; index++) {
      const a = feature.geometry.coordinates[index - 1], b = feature.geometry.coordinates[index];
      if (pointDistance(a, b) < 0.001) continue;
      const from = idFor(a), to = idFor(b);
      nodes.set(from, a); nodes.set(to, b);
      segments.push({ id: `${feature.id}:${index}`, from, to, a, b, sourceId: feature.id, name: feature.properties.name || (feature.properties.tags.highway === 'steps' ? 'les marches' : feature.properties.kind === 'road' ? 'la voie du campus' : 'l’allée'), stairs: feature.properties.tags.highway === 'steps' });
    }
  }
  // An OSM vertex on another way is a junction even if that way omitted the repeated vertex.
  // Geometric crossings without an existing vertex are deliberately not joined.
  const split: WalkSegment[] = [];
  for (const segment of segments) {
    const layer = segment.from.slice(segment.from.indexOf(':'));
    const cuts = [{ id: segment.from, point: segment.a, t: 0 }, { id: segment.to, point: segment.b, t: 1 }];
    for (const [id, point] of nodes) {
      if (id === segment.from || id === segment.to || !id.endsWith(layer)) continue;
      const snap = projectOnSegment(point, segment.a, segment.b);
      if (snap.distance < 0.015 && snap.t > 0.00001 && snap.t < 0.99999) cuts.push({ id, point, t: snap.t });
    }
    cuts.sort((a, b) => a.t - b.t);
    for (let index = 1; index < cuts.length; index++) {
      if (pointDistance(cuts[index - 1].point, cuts[index].point) < 0.001) continue;
      split.push({ ...segment, id: `${segment.id}:${index}`, from: cuts[index - 1].id, to: cuts[index].id, a: cuts[index - 1].point, b: cuts[index].point });
    }
  }
  return { model, nodes, segments: split, obstacles, walls };
}

export function isNearCampus(network: WalkNetwork, point: Coordinate): boolean {
  if (!point.every(Number.isFinite)) return false;
  return insidePolygon(point, network.model.boundary) || network.model.boundary[0].some((end, index, ring) => index > 0 && distanceToSegment(point, ring[index - 1], end) <= 25);
}

function nearestSnap(network: WalkNetwork, point: Coordinate, maximum: number): Snap | null {
  const candidates = network.segments.map((segment) => ({ segment, ...projectOnSegment(point, segment.a, segment.b) })).filter((snap) => snap.distance <= maximum).sort((a, b) => a.distance - b.distance);
  return candidates.find((snap) => connectionIsClear(network, point, snap.point)) ?? null;
}

function addArc(graph: Map<string, Arc[]>, from: string, to: string, leg: RouteLeg) {
  if (!graph.has(from)) graph.set(from, []);
  if (!graph.has(to)) graph.set(to, []);
  graph.get(from)!.push({ to, leg });
  graph.get(to)!.push({ to: from, leg: { ...leg, from: leg.to, to: leg.from } });
}

function shortestPaths(graph: Map<string, Arc[]>, start: string) {
  const distances = new Map<string, number>([[start, 0]]), previous = new Map<string, { from: string; leg: RouteLeg }>();
  const pending = new Set(graph.keys());
  while (pending.size) {
    let closest: string | null = null, best = Infinity;
    for (const id of pending) if ((distances.get(id) ?? Infinity) < best) { closest = id; best = distances.get(id)!; }
    if (closest === null) break;
    pending.delete(closest);
    for (const arc of graph.get(closest) ?? []) {
      const candidate = best + arc.leg.distance;
      if (candidate < (distances.get(arc.to) ?? Infinity) - 1e-8) {
        distances.set(arc.to, candidate); previous.set(arc.to, { from: closest, leg: arc.leg });
      }
    }
  }
  return { distances, previous };
}

function nearbyBuildingSnaps(network: WalkNetwork, building: CampusBuilding): Snap[] {
  const footprint = network.model.campusBuildings.find((entry) => entry.id === building.id);
  if (!footprint) return [];
  // Stop on an existing path near the footprint; do not invent an entrance at the centroid.
  const candidates = footprint.polygons.flatMap((polygon) => polygon[0].flatMap((point) => {
    const snap = nearestSnap(network, point, 18);
    return snap ? [snap] : [];
  })).sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return [];
  return candidates.filter((snap, index) => snap.distance <= candidates[0].distance + 3 && candidates.findIndex((other) => pointDistance(other.point, snap.point) < 0.5) === index).slice(0, 10);
}

export function calculateWalkingRoute(network: WalkNetwork, origin: Coordinate, destination: NavigationDestination, building: CampusBuilding): RouteResult {
  if (!isNearCampus(network, origin)) return { status: 'outside', message: 'Vous êtes hors du campus. Choisissez un départ sur le plan pour préparer votre trajet.' };
  const start = nearestSnap(network, origin, 25);
  if (!start) return { status: 'off-path', message: 'Aucune allée accessible à proximité de ce point. Rejoignez une allée ou choisissez votre départ sur le plan.' };
  const entrances = building.entrances.filter((entrance) => !['no', 'private'].includes(entrance.access) && (!destination.entranceId || entrance.id === destination.entranceId));
  const targets: { snap: Snap; point: Coordinate; entrance: CampusEntrance | null }[] = entrances.flatMap((entrance) => {
    const point: Coordinate = [entrance.position.x, entrance.position.z];
    const snap = nearestSnap(network, point, 5);
    return snap ? [{ snap, point, entrance }] : [];
  });
  if (!building.entrances.length && !destination.entranceId) targets.push(...nearbyBuildingSnaps(network, building).map((snap) => ({ snap, point: snap.point, entrance: null })));
  if (!targets.length) return { status: 'no-access', message: 'L’accès à cette destination n’est pas assez cartographié pour calculer un trajet. Sa position reste visible sur le plan.' };

  const graph = new Map<string, Arc[]>();
  const anchors = [{ id: '@start', snap: start }, ...targets.map((target, index) => ({ id: `@target-${index}`, snap: target.snap }))];
  for (const segment of network.segments) {
    const cuts = [{ id: segment.from, t: 0, point: segment.a }, { id: segment.to, t: 1, point: segment.b }, ...anchors.filter((anchor) => anchor.snap.segment.id === segment.id).map((anchor) => ({ id: anchor.id, t: anchor.snap.t, point: anchor.snap.point }))].sort((a, b) => a.t - b.t);
    for (let index = 1; index < cuts.length; index++) {
      const a = cuts[index - 1], b = cuts[index];
      addArc(graph, a.id, b.id, { from: a.point, to: b.point, distance: pointDistance(a.point, b.point), kind: 'path', sourceId: segment.sourceId, name: segment.name, stairs: segment.stairs });
    }
  }
  const { distances, previous } = shortestPaths(graph, '@start');
  let targetIndex = -1, best = Infinity;
  for (let index = 0; index < targets.length; index++) {
    const total = (distances.get(`@target-${index}`) ?? Infinity) + targets[index].snap.distance;
    if (total < best) { best = total; targetIndex = index; }
  }
  if (targetIndex < 0) return { status: 'disconnected', message: 'Les chemins cartographiés ne relient pas ce départ à cette entrée. Aucun raccourci n’est déduit : choisissez un autre départ.' };
  const target = targets[targetIndex];
  const legs: RouteLeg[] = [];
  let cursor = `@target-${targetIndex}`;
  while (cursor !== '@start') {
    const edge = previous.get(cursor);
    if (!edge) return { status: 'disconnected', message: 'Aucun chemin continu n’est cartographié pour ce trajet.' };
    if (edge.leg.distance > 0.01) legs.unshift(edge.leg);
    cursor = edge.from;
  }
  if (start.distance > 0.1) legs.unshift({ from: origin, to: start.point, distance: start.distance, kind: 'connection', name: 'l’allée', stairs: false });
  if (target.entrance && target.snap.distance > 0.1) legs.push({ from: target.snap.point, to: target.point, distance: target.snap.distance, kind: 'connection', name: 'l’entrée', stairs: false });
  const distance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  return { status: 'ready', route: { legs, points: legs.length ? [legs[0].from, ...legs.map((leg) => leg.to)] : [target.point], distance, minutes: Math.max(1, Math.ceil(distance / 75)), entrance: target.entrance, endpoint: target.point, nearby: !target.entrance, destinationId: destination.id } };
}

export const formatDistance = (meters: number) => meters < 1000 ? `${Math.max(0, Math.round(meters))} m` : `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

export interface RouteInstruction { kind: 'straight' | 'left' | 'right' | 'uturn' | 'connection' | 'stairs'; text: string; distance: number }
export function routeInstructions(route: WalkingRoute): RouteInstruction[] {
  const instructions: RouteInstruction[] = [];
  for (let index = 0; index < route.legs.length; index++) {
    const leg = route.legs[index], previous = route.legs[index - 1];
    if (leg.distance < 0.1) continue;
    let kind: RouteInstruction['kind'] = 'straight';
    if (leg.kind === 'connection') kind = 'connection';
    else if (leg.stairs) kind = 'stairs';
    else if (previous && previous.kind === 'path') {
      const a = subtract(previous.to, previous.from), b = subtract(leg.to, leg.from);
      const angle = Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]) * 180 / Math.PI;
      if (Math.abs(angle) > 145) kind = 'uturn';
      else if (angle > 35) kind = 'right';
      else if (angle < -35) kind = 'left';
    }
    const current = instructions.at(-1);
    if (current && ((kind === 'straight' && previous?.kind === leg.kind && !previous.stairs) || (kind === 'stairs' && current.kind === 'stairs'))) { current.distance += leg.distance; continue; }
    const directions = ['l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest', 'le nord', 'le nord-est'];
    const bearing = (Math.round(Math.atan2(leg.to[1] - leg.from[1], leg.to[0] - leg.from[0]) / (Math.PI / 4)) + 8) % 8;
    const text = kind === 'connection' ? `Rejoignez ${leg.name}` : kind === 'stairs' ? 'Empruntez les marches' : kind === 'left' ? `Tournez à gauche et suivez ${leg.name}` : kind === 'right' ? `Tournez à droite et suivez ${leg.name}` : kind === 'uturn' ? 'Faites demi-tour sur l’allée' : `Suivez ${leg.name} vers ${directions[bearing]}`;
    instructions.push({ kind, text, distance: leg.distance });
  }
  return instructions;
}
