import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CATEGORY_META, DEFAULT_LAYERS, boundsOf, centroid,
  type CampusModel, type CategoryFilter, type MapLayers,
} from './campus';
import { CampusScene, beam, disposeGroup, point3, surface } from './campus-scene';
import { COUR_ROUGE, courRougePosition } from './campus-landmarks';

export interface ViewSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  mode: '2d' | '3d';
}

interface ViewerCallbacks {
  select: (id: string | null) => void;
  selectRoom: (id: string) => void;
  view: (heading: number, scalePixels: number) => void;
  error: () => void;
}

interface MapLabel {
  element: HTMLButtonElement;
  position: THREE.Vector3;
  id: string;
  priority: number;
  room: boolean;
  named: boolean;
  entrance?: boolean;
  buildingId?: string;
  width?: number;
  height?: number;
}


export class CampusViewer extends CampusScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-300, 300, 245, -245, 1, 2000);
  private controls: OrbitControls;
  private selectionRoot = new THREE.Group();
  private indoorRoot = new THREE.Group();
  private labelsRoot = document.createElement('div');
  private labels: MapLabel[] = [];
  private roomMeshes = new Map<string, THREE.Mesh>();
  private observer: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private pointerStart = new THREE.Vector2();
  private layers: MapLayers = { ...DEFAULT_LAYERS };
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private floorBuildingId: string | null = null;
  private filter: CategoryFilter = 'all';
  private mode: '2d' | '3d' = '3d';
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private width = 1;
  private height = 1;
  private destination: { target: THREE.Vector3; zoom: number } | null = null;
  private lastTime = 0;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private host: HTMLElement, model: CampusModel, private callbacks: ViewerCallbacks, snapshot?: ViewSnapshot) {
    super(model);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.domElement.className = 'campus-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Carte 3D du campus. Flèches pour déplacer, plus et moins pour zoomer, origine pour recentrer.');
    this.host.append(this.renderer.domElement);
    this.labelsRoot.className = 'map-labels';
    this.host.append(this.labelsRoot);

    this.camera.position.set(370, 510, 440);
    this.camera.zoom = 1.13;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 7;
    this.controls.minPolarAngle = 0.001;
    this.controls.maxPolarAngle = Math.PI / 2.35;
    this.controls.screenSpacePanning = false;
    this.controls.autoRotateSpeed = 0.65;
    const campusCenter = point3(centroid(model.boundary[0]));
    this.controls.target.copy(campusCenter);
    this.camera.position.add(campusCenter);
    this.controls.addEventListener('change', this.invalidate);
    this.controls.addEventListener('start', this.cancelFlight);
    if (snapshot) {
      this.camera.position.fromArray(snapshot.position);
      this.camera.zoom = snapshot.zoom;
      this.controls.target.fromArray(snapshot.target);
      this.mode = snapshot.mode;
      this.controls.enableRotate = snapshot.mode === '3d';
      this.controls.mouseButtons.LEFT = snapshot.mode === '2d' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      this.controls.touches.ONE = snapshot.mode === '2d' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    }

    const ambient = new THREE.HemisphereLight('#fffdf5', '#9aab8d', 1.65);
    const sunlight = new THREE.DirectionalLight('#fff2dc', 2.1);
    sunlight.position.set(-180, 340, -90);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -340;
    sunlight.shadow.camera.right = 340;
    sunlight.shadow.camera.top = 340;
    sunlight.shadow.camera.bottom = -340;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 850;
    sunlight.shadow.normalBias = 0.12;
    sunlight.shadow.bias = -0.00015;
    sunlight.shadow.radius = 3;
    this.scene.add(ambient, sunlight, this.modelRoot, this.selectionRoot, this.indoorRoot);
    this.buildLabels();

    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.addEventListener('keydown', this.keyDown);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    this.controls.update();
    this.animate(0);
  }

  private buildLabels() {
    const cour = document.createElement('button');
    cour.type = 'button';
    cour.className = 'building-label cour-rouge-label';
    cour.textContent = COUR_ROUGE.name;
    cour.title = COUR_ROUGE.typeLabel;
    const type = document.createElement('small');
    type.textContent = COUR_ROUGE.typeLabel;
    cour.append(type);
    cour.setAttribute('aria-label', 'Centrer sur Cour Rouge');
    cour.addEventListener('click', () => this.focusCourRouge());
    this.labelsRoot.append(cour);
    this.labels.push({ element: cour, id: COUR_ROUGE.id, position: point3(courRougePosition(this.model.data.metadata.origin), 3), priority: 5, room: false, named: true });
    for (const building of this.model.campusBuildings) {
      if (!this.records.has(building.id)) continue;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'building-label';
      element.textContent = building.shortName;
      element.setAttribute('aria-label', `Voir ${building.name}`);
      element.dataset.building = building.id;
      element.addEventListener('click', () => this.callbacks.select(building.id));
      this.labelsRoot.append(element);
      this.labels.push({ element, id: building.id, position: point3(building.center, building.height + 3), priority: building.category === 'department' ? (/\d$/.test(building.name) ? 1 : 3) : building.correction || building.name === 'Administration' ? 2 : 0, room: false, named: building.named });
      for (const room of building.rooms) {
        if (!room.entrance || !room.side) continue;
        const entranceLabel = document.createElement('button');
        entranceLabel.type = 'button';
        entranceLabel.className = 'building-label entrance-label';
        entranceLabel.textContent = room.name;
        entranceLabel.setAttribute('aria-label', `Ouvrir ${room.name}, face ${room.side === 'front' ? 'avant' : 'arrière'}`);
        entranceLabel.dataset.entrance = room.id;
        entranceLabel.addEventListener('click', () => this.callbacks.selectRoom(room.id));
        this.labelsRoot.append(entranceLabel);
        this.labels.push({ element: entranceLabel, id: room.id, buildingId: building.id, position: point3(room.entrance, building.height + 1.5), priority: 4, room: false, entrance: true, named: true });
      }
    }
  }

  setSelection(id: string | null) {
    this.selectedId = id;
    disposeGroup(this.selectionRoot);
    const record = id ? this.records.get(id) : undefined;
    if (record) {
      for (const polygon of record.building.polygons) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(polygon[0].map((point) => point3(point, 0.55))), new THREE.LineBasicMaterial({ color: '#d68e43' }));
        this.selectionRoot.add(line);
      }
    }
    this.updateColors();
    this.invalidate();
  }

  setFilter(filter: CategoryFilter) {
    this.filter = filter;
    this.updateColors();
    this.invalidate();
  }

  private updateColors() {
    for (const record of this.records.values()) {
      const selected = record.building.id === this.selectedId;
      const hovered = record.building.id === this.hoverId;
      const dimmed = this.filter !== 'all' && record.building.category !== this.filter;
      record.roof.color.set(selected ? '#d5a365' : hovered ? '#d4c6a4' : record.building.campus ? CATEGORY_META[record.building.category].roof : '#e3e4d9');
      record.walls.color.set(selected ? '#f1dbb8' : record.building.campus ? '#eeeade' : '#e5e5da');
      if (dimmed && !selected) {
        record.roof.color.lerp(new THREE.Color('#e5e7de'), 0.78);
        record.walls.color.lerp(new THREE.Color('#e5e7de'), 0.7);
      }
    }
  }

  setLayers(layers: MapLayers) {
    this.layers = layers;
    this.buildingsRoot.visible = layers.buildings;
    this.indoorRoot.visible = layers.buildings;
    this.selectionRoot.visible = layers.buildings;
    this.greeneryRoot.visible = layers.greenery;
    this.pathsRoot.visible = layers.paths;
    this.boundaryRoot.visible = layers.boundary;
    for (const record of this.records.values()) record.details.visible = layers.details;
    this.invalidate();
  }

  focusBuilding(id: string) {
    const record = this.records.get(id);
    if (!record) return;
    const bounds = boundsOf(record.building.polygons.flatMap((polygon) => polygon[0]));
    const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    this.flyTo(point3(record.building.center, 0), Math.min(4.3, Math.max(2.2, 220 / extent)));
  }

  focusCourRouge() {
    this.callbacks.select(null);
    this.flyTo(point3(courRougePosition(this.model.data.metadata.origin)), 3.2);
  }

  private flyTo(target: THREE.Vector3, zoom: number) {
    this.controls.autoRotate = false;
    if (this.reduceMotion) {
      this.camera.position.add(target.clone().sub(this.controls.target));
      this.controls.target.copy(target);
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
      this.destination = null;
    } else {
      this.destination = { target, zoom };
    }
    this.invalidate();
  }

  setMode(mode: '2d' | '3d') {
    if (this.mode === mode) return;
    this.mode = mode;
    this.controls.enableRotate = mode === '3d';
    this.controls.mouseButtons.LEFT = mode === '2d' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = mode === '2d' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.controls.autoRotate = false;
    const offset = mode === '2d' ? new THREE.Vector3(0, 680, 0.7) : new THREE.Vector3(370, 510, 440);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.invalidate();
  }

  reset() {
    this.destination = null;
    this.controls.target.copy(point3(centroid(this.model.boundary[0])));
    if (this.mode === '2d') this.camera.position.set(0, 680, 0.7);
    else this.camera.position.set(370, 510, 440);
    this.camera.position.add(this.controls.target);
    this.camera.zoom = 1.13;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  north() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const radius = Math.hypot(offset.x, offset.z);
    this.camera.position.set(this.controls.target.x, this.camera.position.y, this.controls.target.z + radius);
    this.controls.update();
    this.invalidate();
  }

  zoom(direction: number) {
    this.destination = null;
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * (direction > 0 ? 1.25 : 0.8), 0.65, 7);
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  setOrbit(enabled: boolean) {
    this.controls.autoRotate = enabled && this.mode === '3d';
    this.invalidate();
  }

  showFloor(buildingId: string | null, level: number) {
    for (const record of this.records.values()) record.group.visible = true;
    this.floorBuildingId = buildingId;
    disposeGroup(this.indoorRoot);
    this.roomMeshes.clear();
    this.labels.filter((label) => label.room).forEach((label) => label.element.remove());
    this.labels = this.labels.filter((label) => !label.room);
    const record = buildingId ? this.records.get(buildingId) : undefined;
    if (!record) { this.invalidate(); return; }
    record.group.visible = false;
    const elevation = 0.4 + level * 3.5;
    for (const polygon of record.building.polygons) this.indoorRoot.add(surface(polygon, '#f2e8d0', elevation));
    for (const room of record.building.rooms.filter((candidate) => candidate.levels.includes(level))) {
      for (const polygon of room.polygons) {
        const mesh = surface(polygon, room.type === 'library' ? '#b5d4c2' : room.type === 'toilets' ? '#c7d8da' : '#e0c898', elevation + 0.08);
        this.indoorRoot.add(mesh);
        this.roomMeshes.set(room.id, mesh);
        for (const ring of polygon) {
          for (let index = 1; index < ring.length; index++) this.indoorRoot.add(beam(ring[index - 1], ring[index], 0.3, 0.85, elevation, '#faf7eb'));
        }
      }
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'building-label room-label';
      element.textContent = room.name;
      element.setAttribute('aria-label', `${room.name}${room.side ? `, face ${room.side === 'front' ? 'avant' : 'arrière'}` : ''}`);
      element.addEventListener('click', () => this.callbacks.selectRoom(room.id));
      this.labelsRoot.append(element);
      this.labels.push({ element, id: room.id, position: point3(room.center, elevation + 1.5), priority: 4, room: true, named: true });
    }
    this.invalidate();
  }

  selectRoom(id: string | null) {
    for (const [roomId, mesh] of this.roomMeshes) {
      const room = this.model.rooms.find((candidate) => candidate.id === roomId);
      (mesh.material as THREE.MeshStandardMaterial).color.set(roomId === id ? '#cf9452' : room?.type === 'library' ? '#b5d4c2' : room?.type === 'toilets' ? '#c7d8da' : '#e0c898');
    }
    for (const label of this.labels.filter((candidate) => candidate.room)) label.element.classList.toggle('is-selected', label.id === id);
    this.invalidate();
  }

  snapshot(): ViewSnapshot {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom, mode: this.mode };
  }

  async exportGLB(): Promise<ArrayBuffer> {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exportRoot = this.modelRoot.clone(true);
    const clonedMaterials: THREE.MeshStandardMaterial[] = [];
    exportRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.buildingId) return;
      const building = this.records.get(object.userData.buildingId)?.building;
      if (!building || !Array.isArray(object.material)) return;
      object.material = object.material.map((original, index) => {
        const copy = (original as THREE.MeshStandardMaterial).clone();
        copy.color.set(index === 0 ? (building.campus ? CATEGORY_META[building.category].roof : '#e3e4d9') : building.campus ? '#eeeade' : '#e5e5da');
        clonedMaterials.push(copy);
        return copy;
      });
    });
    try {
      const result = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: false });
      if (!(result instanceof ArrayBuffer)) throw new Error('Le modèle 3D n’a pas pu être exporté.');
      return result;
    } finally {
      clonedMaterials.forEach((entry) => entry.dispose());
    }
  }

  private invalidate = () => { this.dirty = true; };
  private cancelFlight = () => { this.destination = null; };

  private resize = () => {
    this.width = this.host.clientWidth || 1;
    this.height = this.host.clientHeight || 1;
    const aspect = this.width / this.height;
    const halfHeight = 245 * Math.max(1, 1 / aspect);
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.invalidate();
  };

  private hitTest(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    if (!this.layers.buildings) return null;
    const meshes = [...this.records.values()].filter((record) => record.building.campus && !record.building.roof && record.group.visible).flatMap((record) => record.meshes);
    return (this.raycaster.intersectObjects(meshes, false)[0]?.object.userData.buildingId as string | undefined) ?? null;
  }

  private pointerDown = (event: PointerEvent) => { this.pointerStart.set(event.clientX, event.clientY); };
  private pointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    const id = this.hitTest(event);
    if (id || !this.floorBuildingId) this.callbacks.select(id);
  };
  private pointerMove = (event: PointerEvent) => {
    if (event.buttons) return;
    const id = this.hitTest(event);
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    this.updateColors();
    this.invalidate();
  };
  private pointerLeave = () => {
    this.hoverId = null;
    this.updateColors();
    this.invalidate();
  };
  private keyDown = (event: KeyboardEvent) => {
    const movement = 16 / this.camera.zoom;
    const offset = new THREE.Vector3();
    if (event.key === 'ArrowUp') offset.z = -movement;
    else if (event.key === 'ArrowDown') offset.z = movement;
    else if (event.key === 'ArrowLeft') offset.x = -movement;
    else if (event.key === 'ArrowRight') offset.x = movement;
    else if (event.key === '+' || event.key === '=') this.zoom(1);
    else if (event.key === '-') this.zoom(-1);
    else if (event.key === 'Home') this.reset();
    else if (event.key === 'Escape') this.callbacks.select(null);
    else return;
    event.preventDefault();
    this.destination = null;
    this.controls.target.add(offset);
    this.camera.position.add(offset);
    this.controls.update();
    this.invalidate();
  };
  private contextLost = (event: Event) => { event.preventDefault(); this.callbacks.error(); };

  private updateLabels() {
    const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
    const sorted = [...this.labels].sort((first, second) => Number(second.id === this.selectedId) - Number(first.id === this.selectedId) || second.priority - first.priority);
    for (const label of sorted) {
      const selected = label.id === this.selectedId;
      const record = this.records.get(label.buildingId ?? label.id);
      const entranceVisible = label.entrance && label.buildingId !== this.floorBuildingId && (label.buildingId === this.selectedId || this.camera.zoom > 2.2);
      const contentVisible = label.entrance ? entranceVisible : (label.room || label.id !== this.floorBuildingId) && (selected || label.room || (label.named && (this.camera.zoom > 1.7 || label.priority > 0)));
      const allowed = this.layers.labels && this.layers.buildings && contentVisible && (this.filter === 'all' || selected || label.buildingId === this.selectedId || label.room || record?.building.category === this.filter);
      if (!allowed) { label.element.style.display = 'none'; continue; }
      const projected = label.position.clone().project(this.camera);
      const horizontal = (projected.x + 1) * this.width / 2;
      const vertical = (1 - projected.y) * this.height / 2;
      if (!label.width || !label.height) {
        label.element.style.display = '';
        label.width = label.element.offsetWidth;
        label.height = label.element.offsetHeight;
      }
      const rectangle = { left: horizontal - label.width / 2 - 5, right: horizontal + label.width / 2 + 5, top: vertical - label.height - 5, bottom: vertical + 3 };
      const overlap = occupied.some((other) => rectangle.left < other.right && rectangle.right > other.left && rectangle.top < other.bottom && rectangle.bottom > other.top);
      const visible = projected.z > -1 && projected.z < 1 && rectangle.left > 5 && rectangle.right < this.width - 5 && rectangle.top > 70 && rectangle.bottom < this.height - 90 && (!overlap || selected);
      label.element.style.display = visible ? '' : 'none';
      if (!visible) continue;
      occupied.push(rectangle);
      label.element.style.transform = `translate(-50%, -100%) translate(${horizontal}px, ${vertical}px)`;
      if (!label.room) label.element.classList.toggle('is-selected', selected);
    }
    const center = this.controls.target.clone().project(this.camera);
    const north = this.controls.target.clone().add(new THREE.Vector3(0, 0, -50)).project(this.camera);
    const heading = Math.atan2((north.x - center.x) * this.width, (north.y - center.y) * this.height) * 180 / Math.PI;
    this.callbacks.view(heading, this.width / ((this.camera.right - this.camera.left) / this.camera.zoom) * 50);
  }

  private animate = (time: number) => {
    if (this.disposed) return;
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    if (this.destination) {
      const progress = 1 - Math.exp(-delta * 7);
      const next = this.controls.target.clone().lerp(this.destination.target, progress);
      this.camera.position.add(next.clone().sub(this.controls.target));
      this.controls.target.copy(next);
      this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, this.destination.zoom, progress);
      this.camera.updateProjectionMatrix();
      if (this.controls.target.distanceTo(this.destination.target) < 0.05 && Math.abs(this.camera.zoom - this.destination.zoom) < 0.005) this.destination = null;
      this.dirty = true;
    }
    const changed = this.controls.update(delta);
    if ((this.dirty || changed) && !document.hidden) {
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.dirty = false;
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.removeEventListener('change', this.invalidate);
    this.controls.removeEventListener('start', this.cancelFlight);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.removeEventListener('keydown', this.keyDown);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    disposeGroup(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelsRoot.remove();
  }
}
