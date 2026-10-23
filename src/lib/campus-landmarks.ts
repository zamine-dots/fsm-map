import courtyard from '../data/cour-rouge.json';
import { boundsOf, insidePolygon, project, type Coordinate, type Polygon } from './campus';

/** The OSM point is the reference; the user-identified surface has an approximate outline. */
export const COUR_ROUGE = {
  id: 'node/7228004560',
  kind: 'courtyard',
  name: 'Cour Rouge',
  typeLabel: 'Cour extérieure',
  description: 'Cour centrale et espace de rencontre en plein air.',
  coordinates: [10.8050401, 35.7643203] as Coordinate,
  color: courtyard.appearance.pavingColor,
  paving: courtyard.appearance,
  modelNodeName: 'landmark_cour_rouge',
  source: courtyard.source,
} as const;

export const courRougePosition = (origin: Coordinate): Coordinate => project(COUR_ROUGE.coordinates, origin);

export const courRougePolygon = (origin: Coordinate): Polygon =>
  (courtyard.geometry.coordinates as Polygon).map((ring) => ring.map((point) => project(point, origin)));

/** Illustrative paving joints aligned with the courtyard, clipped out of all garden islands. */
export function courRougePavingJoints(origin: Coordinate): [Coordinate, Coordinate][] {
  const polygon = courRougePolygon(origin);
  const anchor = polygon[0][0];
  const angle = Math.atan2(polygon[0][1][1] - anchor[1], polygon[0][1][0] - anchor[0]);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const toLocal = (point: Coordinate): Coordinate => [(point[0] - anchor[0]) * cos + (point[1] - anchor[1]) * sin, -(point[0] - anchor[0]) * sin + (point[1] - anchor[1]) * cos];
  const toMap = (point: Coordinate): Coordinate => [anchor[0] + point[0] * cos - point[1] * sin, anchor[1] + point[0] * sin + point[1] * cos];
  const localPolygon = polygon.map((ring) => ring.map(toLocal));
  const bounds = boundsOf(localPolygon[0]);
  const segments: [Coordinate, Coordinate][] = [];
  const clipLine = (axis: 0 | 1, coordinate: number) => {
    const other = axis === 0 ? 1 : 0;
    const crossings: number[] = [];
    for (const ring of localPolygon) for (let index = 1; index < ring.length; index++) {
      const a = ring[index - 1], b = ring[index];
      if ((a[axis] > coordinate) === (b[axis] > coordinate)) continue;
      const t = (coordinate - a[axis]) / (b[axis] - a[axis]);
      crossings.push(a[other] + (b[other] - a[other]) * t);
    }
    crossings.sort((a, b) => a - b);
    for (let index = 1; index < crossings.length; index++) {
      const first: Coordinate = axis === 0 ? [coordinate, crossings[index - 1]] : [crossings[index - 1], coordinate];
      const second: Coordinate = axis === 0 ? [coordinate, crossings[index]] : [crossings[index], coordinate];
      if (crossings[index] - crossings[index - 1] > .1 && insidePolygon([(first[0] + second[0]) / 2, (first[1] + second[1]) / 2], localPolygon)) segments.push([toMap(first), toMap(second)]);
    }
  };
  const spacing = COUR_ROUGE.paving.gridSpacingMeters;
  for (let x = Math.ceil(bounds.minX / spacing) * spacing; x < bounds.maxX; x += spacing) clipLine(0, x);
  for (let z = Math.ceil(bounds.minZ / spacing) * spacing; z < bounds.maxZ; z += spacing) clipLine(1, z);
  return segments;
}

export function matchesCourRouge(query: string): boolean {
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, '');
  return normalized.length >= 2 && ['courrouge', 'courcentrale'].some((name) => name.includes(normalized));
}

export function courRougeReference(point: Coordinate, origin: Coordinate) {
  const target = courRougePosition(origin);
  const dx = target[0] - point[0];
  const dz = target[1] - point[1];
  const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  const directions = ['au nord', 'au nord-est', 'à l’est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l’ouest', 'au nord-ouest'];
  return { distance: Math.round(Math.hypot(dx, dz)), bearing, direction: directions[Math.round(bearing / 45) % 8] };
}
