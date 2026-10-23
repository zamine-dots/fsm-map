import { boundsOf, centroid, insidePolygon, type Coordinate, type Polygon } from './campus.ts';

export const BUILDING_TAGS_KEY = 'fsm-building-tags-v1';
export const MAX_BUILDING_TAGS = 500;

export interface BuildingTag {
  id: string;
  buildingId: string;
  label: string;
  floor: number | null;
  /** Model metres, so tags stay attached when the preview changes size. */
  point: Coordinate;
  /** Optional personal schedule link; the label survives removal of that course. */
  courseId: string | null;
}

function text(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} : renseignez un texte de 1 à ${maximum} caractères.`);
  }
  return value.trim();
}

export function parseBuildingTag(value: unknown): BuildingTag {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tag invalide.');
  const tag = value as Record<string, unknown>;
  const id = text(tag.id, 'Identifiant', 160);
  const buildingId = text(tag.buildingId, 'Bâtiment', 160);
  const label = text(tag.label, 'Nom du tag', 100);
  if (tag.floor !== null && (typeof tag.floor !== 'number' || !Number.isInteger(tag.floor) || tag.floor < -20 || tag.floor > 200)) {
    throw new Error('Le niveau doit être un entier entre −20 et 200, ou rester non précisé.');
  }
  if (!Array.isArray(tag.point) || tag.point.length !== 2 ||
    !tag.point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= 2000)) {
    throw new Error('Position du tag invalide.');
  }
  const courseId = tag.courseId === null ? null : text(tag.courseId, 'Cours associé', 160);
  return { id, buildingId, label, floor: tag.floor as number | null, point: [tag.point[0], tag.point[1]], courseId };
}

export function parseBuildingTags(value: unknown): BuildingTag[] {
  if (!Array.isArray(value) || value.length > MAX_BUILDING_TAGS) throw new Error(`Maximum ${MAX_BUILDING_TAGS} tags par sauvegarde.`);
  const ids = new Set<string>();
  return value.map((entry) => {
    const tag = parseBuildingTag(entry);
    if (ids.has(tag.id)) throw new Error('Deux tags ont le même identifiant.');
    ids.add(tag.id);
    return tag;
  });
}

export function serializeBuildingTags(tags: BuildingTag[]): string {
  return JSON.stringify({ format: 'fsm-building-tags', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', tags: parseBuildingTags(tags) }, null, 2);
}

export function parseBuildingTagsBackup(raw: string): BuildingTag[] {
  if (raw.length > 1_048_576 || new TextEncoder().encode(raw).byteLength > 1_048_576) throw new Error('La sauvegarde des tags dépasse 1 Mo.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sauvegarde de tags invalide.');
  const envelope = value as Record<string, unknown>;
  if (envelope.format !== 'fsm-building-tags' || envelope.version !== 1 || envelope.campusId !== 'fsm-campus' || envelope.coordinates !== 'local-metres') {
    throw new Error('Format de sauvegarde des tags non reconnu.');
  }
  return parseBuildingTags(envelope.tags);
}

export const pointInFootprint = (point: Coordinate, polygons: Polygon[]) => polygons.some((polygon) => insidePolygon(point, polygon));

/** A centroid may lie in a courtyard hole. Find a point actually inside the footprint. */
export function interiorPoint(polygons: Polygon[]): Coordinate | null {
  for (const polygon of polygons) {
    const center = centroid(polygon[0]);
    if (insidePolygon(center, polygon)) return center;
    const bounds = boundsOf(polygon[0]);
    for (let row = 1; row < 20; row++) {
      for (let column = 1; column < 20; column++) {
        const point: Coordinate = [bounds.minX + (bounds.maxX - bounds.minX) * column / 20, bounds.minZ + (bounds.maxZ - bounds.minZ) * row / 20];
        if (insidePolygon(point, polygon)) return point;
      }
    }
    // Very narrow or angled footprints can fall between the grid samples.
    for (let index = 1; index < polygon[0].length; index++) {
      const first = polygon[0][index - 1];
      const second = polygon[0][index];
      const dx = second[0] - first[0];
      const dz = second[1] - first[1];
      const length = Math.hypot(dx, dz);
      if (!length) continue;
      for (const side of [-1, 1]) {
        const point: Coordinate = [(first[0] + second[0]) / 2 - side * dz / length * 0.001, (first[1] + second[1]) / 2 + side * dx / length * 0.001];
        if (insidePolygon(point, polygon)) return point;
      }
    }
  }
  return null;
}

export const polygonPath = (polygon: Polygon) => polygon.map((ring) => `${ring.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ')} Z`).join(' ');
