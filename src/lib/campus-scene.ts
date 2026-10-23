import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CATEGORY_META, boundsOf, distanceToSegment, insidePolygon, polygonArea, polygonsOf,
  type CampusBuilding, type CampusModel, type Coordinate, type Polygon,
} from './campus';
import { COUR_ROUGE, courRougePavingJoints, courRougePolygon } from './campus-landmarks';

interface BuildingRecord {
  building: CampusBuilding;
  group: THREE.Group;
  details: THREE.Group;
  meshes: THREE.Mesh[];
  roof: THREE.MeshStandardMaterial;
  walls: THREE.MeshStandardMaterial;
}

export const point3 = (point: Coordinate, height = 0) => new THREE.Vector3(point[0], height, point[1]);
const material = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 });

function shapeOf(polygon: Polygon) {
  const pathPoints = (ring: Coordinate[]) => ring.map((point) => new THREE.Vector2(point[0], -point[1]));
  const shape = new THREE.Shape(pathPoints(polygon[0]));
  for (const hole of polygon.slice(1)) shape.holes.push(new THREE.Path(pathPoints(hole)));
  return shape;
}

export function surface(polygon: Polygon, color: THREE.ColorRepresentation, elevation: number) {
  const geometry = new THREE.ShapeGeometry(shapeOf(polygon));
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.y = elevation;
  mesh.receiveShadow = true;
  return mesh;
}

function extrusion(polygon: Polygon, depth: number, materials: THREE.Material | THREE.Material[]) {
  const geometry = new THREE.ExtrudeGeometry(shapeOf(polygon), { depth, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function beam(start: Coordinate, end: Coordinate, width: number, height: number, elevation: number, color: THREE.ColorRepresentation) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), material(color));
  mesh.position.set((start[0] + end[0]) / 2, elevation + height / 2, (start[1] + end[1]) / 2);
  mesh.rotation.y = -Math.atan2(end[1] - start[1], end[0] - start[0]);
  mesh.receiveShadow = true;
  return mesh;
}

function clippedSegment(start: Coordinate, end: Coordinate): [Coordinate, Coordinate] | null {
  const delta = [end[0] - start[0], end[1] - start[1]];
  const directions = [-delta[0], delta[0], -delta[1], delta[1]];
  const distances = [start[0] + 252, 252 - start[0], start[1] + 252, 252 - start[1]];
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 4; index++) {
    if (directions[index] === 0 && distances[index] < 0) return null;
    if (directions[index] === 0) continue;
    const ratio = distances[index] / directions[index];
    if (directions[index] < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return null;
  }
  return [[start[0] + lower * delta[0], start[1] + lower * delta[1]], [start[0] + upper * delta[0], start[1] + upper * delta[1]]];
}

function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      for (const entry of Array.isArray(object.material) ? object.material : [object.material]) materials.add(entry);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((entry) => entry.dispose());
  group.clear();
}

function batchStaticMeshes(group: THREE.Group) {
  const batches = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || !(child.material instanceof THREE.MeshStandardMaterial)) continue;
    const key = `${child.material.color.getHex()}-${child.castShadow}-${child.receiveShadow}`;
    const batch = batches.get(key) ?? [];
    batch.push(child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>);
    batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    if (batch.length < 2) continue;
    const geometries = batch.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((part) => part.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, batch[0].material);
    merged.castShadow = batch[0].castShadow;
    merged.receiveShadow = batch[0].receiveShadow;
    for (const mesh of batch) {
      group.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material !== merged.material) mesh.material.dispose();
    }
    group.add(merged);
  }
}


export function buildingMeshName(id: string, part = 0): string {
  const name = `building_${id.replace('/', '_')}`;
  return part === 0 ? name : `${name}_part_${part}`;
}

// Shared with the original explorer so exported geometry cannot drift from its source.
export class CampusScene {
  readonly modelRoot = new THREE.Group();
  protected buildingsRoot = new THREE.Group();
  protected greeneryRoot = new THREE.Group();
  protected pathsRoot = new THREE.Group();
  protected boundaryRoot = new THREE.Group();
  protected records = new Map<string, BuildingRecord>();

  constructor(protected model: CampusModel) {
    this.modelRoot.name = 'Faculté des Sciences de Monastir';
    this.modelRoot.userData = { ...model.data.metadata, units: 'metres', north: '-Z', elevations: 'Estimated; see building metadata' };
    this.modelRoot.add(this.buildingsRoot, this.greeneryRoot, this.pathsRoot, this.boundaryRoot);
    this.buildTerrain();
    this.buildLandscaping();
    for (const building of model.buildings) this.buildBuilding(building);
    batchStaticMeshes(this.modelRoot);
    batchStaticMeshes(this.pathsRoot);
    batchStaticMeshes(this.greeneryRoot);
    this.modelRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData.castShadow = object.castShadow;
      object.userData.receiveShadow = object.receiveShadow;
    });
  }

  private buildTerrain() {
    const edge = 260;
    const radius = 10;
    const shape = new THREE.Shape();
    shape.moveTo(-edge + radius, -edge);
    shape.lineTo(edge - radius, -edge);
    shape.quadraticCurveTo(edge, -edge, edge, -edge + radius);
    shape.lineTo(edge, edge - radius);
    shape.quadraticCurveTo(edge, edge, edge - radius, edge);
    shape.lineTo(-edge + radius, edge);
    shape.quadraticCurveTo(-edge, edge, -edge, edge - radius);
    shape.lineTo(-edge, -edge + radius);
    shape.quadraticCurveTo(-edge, -edge, -edge + radius, -edge);
    const baseGeometry = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1, bevelSegments: 2, steps: 1 });
    baseGeometry.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(baseGeometry, [material('#e4e7dc'), material('#c9d0bf')]);
    base.position.y = -6.2;
    base.receiveShadow = true;
    base.name = 'Socle du campus';
    this.modelRoot.add(base);
    this.modelRoot.add(surface(this.model.boundary, '#e6e4d3', 0.02));

    const cour = surface(courRougePolygon(this.model.data.metadata.origin), COUR_ROUGE.color, 0.035);
    cour.name = COUR_ROUGE.modelNodeName;
    cour.userData = { landmarkId: COUR_ROUGE.id, placeKind: COUR_ROUGE.kind, displayName: COUR_ROUGE.name, representation: 'Outdoor terracotta courtyard with garden cutouts', source: COUR_ROUGE.source, appearance: COUR_ROUGE.paving };
    // Keep this mesh named and separate from static batches so reference metadata survives export.
    const courtyardRoot = new THREE.Group();
    courtyardRoot.add(cour);
    const paving = new THREE.Group();
    paving.name = 'landmark_cour_rouge_paving';
    paving.userData = { landmarkId: COUR_ROUGE.id, placeKind: COUR_ROUGE.kind, representation: 'Illustrative paving joints, not walking paths' };
    for (const [start, end] of courRougePavingJoints(this.model.data.metadata.origin)) {
      paving.add(beam(start, end, COUR_ROUGE.paving.jointWidthMeters, .006, .04, COUR_ROUGE.paving.jointColor));
    }
    batchStaticMeshes(paving);
    courtyardRoot.add(paving);
    this.modelRoot.add(courtyardRoot);

    for (const feature of this.model.features) {
      const kind = feature.properties.kind;
      if (['path', 'road'].includes(kind) && feature.geometry.type === 'LineString') {
        const footpath = kind === 'path';
        const tags = feature.properties.tags;
        const roadWidth = ['primary', 'secondary', 'primary_link'].includes(tags.highway) ? 7.5 : tags.highway === 'residential' ? 5.5 : 3.9;
        const width = footpath ? (tags.highway === 'steps' ? 1.8 : 2.1) : roadWidth;
        const target = footpath ? this.pathsRoot : this.modelRoot;
        for (let index = 1; index < feature.geometry.coordinates.length; index++) {
          const segment = clippedSegment(feature.geometry.coordinates[index - 1], feature.geometry.coordinates[index]);
          if (!segment) continue;
          target.add(beam(segment[0], segment[1], width + (footpath ? 0.6 : 2), 0.09, 0.06, '#f0ecdf'));
          target.add(beam(segment[0], segment[1], width, 0.09, 0.17, footpath ? '#d8ccb2' : '#b8c0b7'));
        }
      }
      if (['parking', 'path', 'pitch'].includes(kind)) {
        for (const polygon of polygonsOf(feature.geometry)) {
          const color = kind === 'pitch' ? '#b9c5a1' : kind === 'parking' ? '#cbd0c3' : '#d8ad94';
          (kind === 'path' ? this.pathsRoot : this.modelRoot).add(surface(polygon, color, 0.15));
        }
      }
    }

    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.model.boundary[0].map((point) => point3(point, 0.4))), new THREE.LineDashedMaterial({ color: '#9c926f', dashSize: 2.8, gapSize: 2.2, transparent: true, opacity: 0.65 }));
    outline.computeLineDistances();
    this.boundaryRoot.add(outline);
    this.boundaryRoot.name = 'Limite OpenStreetMap de la FSM';
  }

  private buildLandscaping() {
    const trees: { position: Coordinate; radius: number; height: number; color: string }[] = [];
    const gardenColors = ['#bccb9e', '#c5d0a7', '#adbf91', '#c8d3b0'];
    for (const feature of this.model.features) {
      if (feature.properties.kind !== 'garden') continue;
      const random = randomFrom(Number(feature.properties.osmId));
      for (const polygon of polygonsOf(feature.geometry)) {
        const bounds = boundsOf(polygon[0]);
        if (Math.abs(bounds.minX) > 252 || Math.abs(bounds.maxX) > 252 || Math.abs(bounds.minZ) > 252 || Math.abs(bounds.maxZ) > 252) continue;
        this.greeneryRoot.add(surface(polygon, gardenColors[Math.floor(random() * gardenColors.length)], 0.2));
        const count = Math.min(24, Math.floor(polygonArea(polygon) / 57));
        let planted = 0;
        for (let attempt = 0; attempt < count * 15 && planted < count; attempt++) {
          const point: Coordinate = [bounds.minX + random() * (bounds.maxX - bounds.minX), bounds.minZ + random() * (bounds.maxZ - bounds.minZ)];
          if (!insidePolygon(point, polygon) || this.model.buildings.some((building) => building.polygons.some((footprint) => insidePolygon(point, footprint)))) continue;
          if (trees.some((tree) => Math.hypot(point[0] - tree.position[0], point[1] - tree.position[1]) < 4)) continue;
          trees.push({ position: point, radius: 1.7 + random() * 1.25, height: 3.6 + random() * 2.5, color: ['#688a4b', '#779854', '#8aa166', '#587f4d'][Math.floor(random() * 4)] });
          planted++;
        }
      }
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.28, 1, 6), material('#867257'), trees.length);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material('#ffffff'), trees.length);
    const dummy = new THREE.Object3D();
    trees.forEach((tree, index) => {
      dummy.position.set(tree.position[0], tree.height / 2, tree.position[1]);
      dummy.scale.set(1, tree.height, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      dummy.position.y = tree.height;
      dummy.scale.set(tree.radius, tree.radius * 1.15, tree.radius);
      dummy.rotation.y = index * 1.7;
      dummy.updateMatrix();
      crowns.setMatrixAt(index, dummy.matrix);
      crowns.setColorAt(index, new THREE.Color(tree.color));
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    this.greeneryRoot.add(trunks, crowns);
    this.greeneryRoot.name = 'Jardins OSM et arbres illustratifs';
  }

  private buildBuilding(building: CampusBuilding) {
    if (Math.abs(building.center[0]) > 243 || Math.abs(building.center[1]) > 243) return;
    const group = new THREE.Group();
    const details = new THREE.Group();
    details.name = `details_${building.id.replace('/', '_')}`;
    group.name = building.name;
    group.userData = { osmId: building.id, displayName: building.name, campus: building.campus, height: building.height, heightEstimated: building.heightEstimated, levels: building.levels, levelsFromRooms: building.levelsFromRooms, campusCorrection: building.correction, localEdit: building.edited };
    const roof = material(building.campus ? CATEGORY_META[building.category].roof : '#e3e4d9');
    const walls = material(building.campus ? '#eeeade' : '#e5e5da');
    const meshes: THREE.Mesh[] = [];
    for (const [part, polygon] of building.polygons.entries()) {
      const mesh = extrusion(polygon, building.roof ? 0.35 : building.height, [roof, walls]);
      mesh.position.y = building.roof ? 3.1 : 0.28;
      mesh.name = buildingMeshName(building.id, part);
      mesh.userData.buildingId = building.id;
      meshes.push(mesh);
      group.add(mesh);
      if (building.roof) continue;

      const windows: { start: Coordinate; end: Coordinate; position: number; level: number }[] = [];
      for (const ring of polygon) {
        for (let index = 1; index < ring.length; index++) {
          const start = ring[index - 1];
          const end = ring[index];
          const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
          if (length < 0.4) continue;
          const parapet = beam(start, end, 0.27, 0.48, building.height + 0.28, '#f5f0e3');
          parapet.castShadow = true;
          details.add(parapet);
          const columns = Math.floor((length - 1.5) / 3.5);
          for (let column = 1; column <= columns; column++) {
            const position = column / (columns + 1);
            const point: Coordinate = [start[0] + (end[0] - start[0]) * position, start[1] + (end[1] - start[1]) * position];
            const besideDoor = building.rooms.some((room) => room.entrance && Math.hypot(point[0] - room.entrance[0], point[1] - room.entrance[1]) < 2);
            for (let level = 0; level < building.levels; level++) {
              if (level === 0 && besideDoor) continue;
              windows.push({ start, end, position, level });
            }
          }
        }
      }

      if (windows.length) {
        const windowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.45, 1.35, 0.16), material(building.campus ? '#74928b' : '#a2ada2'), windows.length);
        const dummy = new THREE.Object3D();
        windows.forEach((window, index) => {
          dummy.position.set(window.start[0] + (window.end[0] - window.start[0]) * window.position, 2 + window.level * (building.height / building.levels), window.start[1] + (window.end[1] - window.start[1]) * window.position);
          dummy.rotation.y = -Math.atan2(window.end[1] - window.start[1], window.end[0] - window.start[0]);
          dummy.updateMatrix();
          windowMesh.setMatrixAt(index, dummy.matrix);
        });
        details.add(windowMesh);
      }

      if (building.campus && polygonArea(polygon) > 380) {
        const bounds = boundsOf(polygon[0]);
        const random = randomFrom(Number(building.feature.properties.osmId));
        for (let index = 0; index < 2; index++) {
          const position: Coordinate = [bounds.minX + (0.2 + random() * 0.6) * (bounds.maxX - bounds.minX), bounds.minZ + (0.2 + random() * 0.6) * (bounds.maxZ - bounds.minZ)];
          if (!insidePolygon(position, polygon)) continue;
          const unit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.7), material('#a8b1a4'));
          unit.position.set(position[0], building.height + 0.7, position[1]);
          unit.castShadow = true;
          details.add(unit);
        }
      }
    }
    for (const room of building.rooms) {
      if (!room.entrance || !room.side) continue;
      const entrance = room.entrance;
      const edges = building.polygons.flatMap((polygon) => polygon[0].slice(1).map((end, index) => ({ start: polygon[0][index], end })));
      const edge = edges.sort((first, second) => distanceToSegment(entrance, first.start, first.end) - distanceToSegment(entrance, second.start, second.end))[0];
      if (!edge) continue;
      const angle = -Math.atan2(edge.end[1] - edge.start[1], edge.end[0] - edge.start[0]);
      const normal: Coordinate = [Math.sin(angle), Math.cos(angle)];
      const outward = building.polygons.some((polygon) => insidePolygon([entrance[0] + normal[0] * 0.5, entrance[1] + normal[1] * 0.5], polygon)) ? -1 : 1;
      const doorway = new THREE.Group();
      doorway.name = `${room.name} — face ${room.side === 'front' ? 'avant' : 'arrière'}`;
      doorway.userData = { roomId: room.id, side: room.side, entranceId: building.correction?.rooms[room.id].entranceId };
      doorway.position.set(entrance[0] + normal[0] * outward * 0.07, 0.28, entrance[1] + normal[1] * outward * 0.07);
      doorway.rotation.y = angle;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.95, 0.25), material('#f4ebd5'));
      frame.position.y = 1.475;
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.95, 2.6, 0.32), material('#3b6258'));
      door.position.y = 1.3;
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 0.95), material('#e0cfaa'));
      canopy.position.set(0, 3.04, outward * 0.4);
      canopy.castShadow = true;
      doorway.add(frame, door, canopy);
      details.add(doorway);
    }
    batchStaticMeshes(details);
    group.add(details);
    this.buildingsRoot.add(group);
    this.records.set(building.id, { building, group, details, meshes, roof, walls });
  }

}
