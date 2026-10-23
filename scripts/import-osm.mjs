import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: npm run import:osm -- /path/to/campus.osm');
  process.exit(1);
}

const xml = await readFile(resolve(sourcePath), 'utf8');
if (!xml.includes('<osm ')) throw new Error('Expected an OpenStreetMap XML document.');

const decode = (value) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&(quot|apos|lt|gt|amp);/g, (_, entity) => ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[entity]);

const attributes = (content) => Object.fromEntries(
  [...content.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], decode(match[2])]),
);
const tagsOf = (content) => Object.fromEntries(
  [...content.matchAll(/<tag\b([^>]*)\/>/g)].map((match) => {
    const tag = attributes(match[1]);
    return [tag.k, tag.v];
  }),
);

const nodes = new Map();
for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
  const attrs = attributes(match[1]);
  nodes.set(attrs.id, { coordinates: [Number(attrs.lon), Number(attrs.lat)], tags: tagsOf(match[2] ?? '') });
}

const ways = new Map();
for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
  const attrs = attributes(match[1]);
  const refs = [...match[2].matchAll(/<nd\b([^>]*)\/>/g)].map((node) => attributes(node[1]).ref);
  ways.set(attrs.id, { refs, tags: tagsOf(match[2]) });
}

const coordinatesOf = (refs) => refs.map((ref) => {
  const node = nodes.get(ref);
  if (!node) throw new Error(`Missing node ${ref}; download the complete bounding box.`);
  return node.coordinates;
});

const insideRing = (point, ring) => {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const start = ring[current];
    const end = ring[previous];
    if ((start[1] > point[1]) !== (end[1] > point[1]) &&
        point[0] < (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return inside;
};

const boundaryWay = ways.get('687347611');
if (!boundaryWay) throw new Error('The FSM campus boundary (way 687347611) is missing.');
const boundary = coordinatesOf(boundaryWay.refs);
const midpoint = (points) => points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);

const classify = (tags, id) => {
  if (id === '687347611') return 'boundary';
  if (tags.building && tags.building !== 'no') return 'building';
  if (tags.indoor === 'room') return 'room';
  if (tags.indoor && tags.highway) return 'corridor';
  if (tags.highway && !['traffic_signals', 'crossing', 'street_lamp', 'bus_stop'].includes(tags.highway)) {
    return ['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(tags.highway) ? 'path' : 'road';
  }
  if (['garden', 'park'].includes(tags.leisure) || ['grass', 'village_green', 'forest'].includes(tags.landuse) || ['wood', 'scrub'].includes(tags.natural)) return 'garden';
  if (tags.leisure === 'pitch') return 'pitch';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.natural === 'tree') return 'tree';
  if (tags.entrance) return 'entrance';
  if (tags.name && (tags.amenity || tags.place === 'square')) return 'poi';
  if (['wall', 'fence'].includes(tags.barrier)) return 'wall';
  return null;
};

const features = [];
const addFeature = (osmType, osmId, tags, geometry) => {
  const kind = classify(tags, osmId);
  if (!kind) return;
  const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' ? geometry.coordinates : geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  const center = midpoint(points);
  const campus = insideRing(center, boundary) || points.some((point) => insideRing(point, boundary));
  features.push({
    type: 'Feature',
    id: `${osmType}/${osmId}`,
    properties: { osmType, osmId, kind, campus, name: tags['name:fr'] ?? tags.name ?? '', tags },
    geometry,
  });
};

const joinRings = (segments) => {
  const pending = segments.map((segment) => [...segment]);
  const rings = [];
  while (pending.length) {
    const ring = pending.shift();
    while (ring[0] !== ring.at(-1)) {
      const nextIndex = pending.findIndex((segment) => segment[0] === ring.at(-1) || segment.at(-1) === ring.at(-1));
      if (nextIndex < 0) throw new Error('An OSM multipolygon has an incomplete ring.');
      const next = pending.splice(nextIndex, 1)[0];
      if (next.at(-1) === ring.at(-1)) next.reverse();
      ring.push(...next.slice(1));
    }
    rings.push(coordinatesOf(ring));
  }
  return rings;
};

const relationMembers = new Set();
for (const match of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
  const attrs = attributes(match[1]);
  const tags = tagsOf(match[2]);
  if (tags.type !== 'multipolygon' || !classify(tags, attrs.id)) continue;
  const members = [...match[2].matchAll(/<member\b([^>]*)\/>/g)].map((member) => attributes(member[1])).filter((member) => member.type === 'way');
  const memberRefs = (role) => members.filter((member) => (member.role || 'outer') === role).map((member) => {
    const way = ways.get(member.ref);
    if (!way) throw new Error(`Missing multipolygon member ${member.ref}.`);
    relationMembers.add(member.ref);
    return way.refs;
  });
  const outers = joinRings(memberRefs('outer'));
  const inners = joinRings(memberRefs('inner'));
  const polygons = outers.map((outer) => [outer, ...inners.filter((inner) => insideRing(inner[0], outer))]);
  if (!polygons.length) throw new Error(`Missing outer polygon in relation ${attrs.id}.`);
  addFeature('relation', attrs.id, tags, polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons });
}

for (const [osmId, way] of ways) {
  const kind = classify(way.tags, osmId);
  if (!kind || relationMembers.has(osmId)) continue;
  const coordinates = coordinatesOf(way.refs);
  const isClosed = way.refs[0] === way.refs.at(-1);
  const isArea = ['boundary', 'building', 'room', 'garden', 'pitch', 'parking'].includes(kind) || way.tags.area === 'yes';
  addFeature('way', osmId, way.tags, isArea && isClosed ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates });
}

for (const [osmId, node] of nodes) {
  const kind = classify(node.tags, osmId);
  if (!['tree', 'entrance', 'poi'].includes(kind)) continue;
  addFeature('node', osmId, node.tags, { type: 'Point', coordinates: node.coordinates });
}

const output = {
  type: 'FeatureCollection',
  metadata: {
    name: 'Faculté des Sciences de Monastir',
    origin: [10.80535, 35.7648],
    retrievedAt: new Date().toISOString().slice(0, 10),
    source: 'https://www.openstreetmap.org/way/687347611',
    sourceUrl: 'https://www.openstreetmap.org/api/0.6/map?bbox=10.8029,35.7628,10.8078,35.7669',
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL-1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    notes: 'OSM footprints, names, levels and partial indoor plans. Heights are inferred from levels at 3.5 m per level when no height is recorded. Façade details and garden trees are illustrative. Not a surveyed or complete indoor map.',
  },
  features,
};

const destination = resolve('public/data/campus.geojson');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(output)}\n`);
console.log(`Imported ${features.length} features into ${destination}`);
console.log(JSON.stringify(features.reduce((counts, feature) => {
  counts[feature.properties.kind] = (counts[feature.properties.kind] ?? 0) + 1;
  return counts;
}, {}), null, 2));
