import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Map as MapIcon, RotateCcw } from 'lucide-react';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { Box3, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, MOUSE, OrthographicCamera, SRGBColorSpace, TOUCH, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';
import { MODEL_URL, modelManifest } from '../lib/model-assets';
import { courRougePosition } from '../lib/campus-landmarks';
import { useResolvedTheme } from '../lib/useResolvedTheme';
import { useAppStore, useMapStore } from '../store/useAppStore';
import BuildingPicker from './map/BuildingPicker';
import CampusLabels from './map/CampusLabels';
import SelectionMarker from './map/SelectionMarker';
import MapLoading from './MapLoading';
import NavigationScene, { type MapNavigation } from './map/NavigationScene';
import { Link } from 'react-router-dom';

function MapUnavailable({ onRetry, fallback }: { onRetry: () => void; fallback?: ReactNode }) {
  if (fallback) return <>{fallback}</>;
  return <div className="nav-map-unavailable" data-state="error" role="alert">
    <span className="nav-loading-mark"><MapIcon size={30} strokeWidth={1.4} /></span>
    <h2>Le campus reste accessible.</h2>
    <p>Le modèle 3D n’a pas pu s’afficher. Tous les bâtiments et leurs fiches restent disponibles dans la liste, sans WebGL.</p>
    <Link className="nav-primary-button" to="/map?view=list">Ouvrir la liste des bâtiments<MapIcon size={17} /></Link>
    <a className="nav-retry-button" href="/explore">Ouvrir le plan accessible</a>
    <button className="nav-retry-button" type="button" onClick={onRetry}><RotateCcw size={16} />Réessayer la 3D</button>
  </div>;
}

class MapBoundary extends Component<{ children: ReactNode; onRetry: () => void; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <MapUnavailable onRetry={this.props.onRetry} fallback={this.props.fallback} /> : this.props.children; }
}

const configureLoader = (loader: GLTFLoader) => loader.setMeshoptDecoder(MeshoptDecoder);
const reportProgress = (event: ProgressEvent<EventTarget>) => {
  if (event.total > 0) useMapStore.getState().setModelProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
};

function stopCameraMotion(orbit: OrbitControlsType, camera: OrthographicCamera) {
  const position = camera.position.clone();
  const target = orbit.target.clone();
  const zoom = camera.zoom;
  const damping = orbit.enableDamping;
  // Flush OrbitControls' private inertia without moving the visible camera.
  orbit.enableDamping = false;
  orbit.update();
  camera.position.copy(position);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  orbit.target.copy(target);
  orbit.update();
  orbit.enableDamping = damping;
}

function CampusAsset({ onReady, interactive = true }: { onReady: () => void; interactive?: boolean }) {
  const asset = useLoader(GLTFLoader, MODEL_URL, configureLoader, reportProgress);
  const lowPower = useAppStore((state) => state.lowPower);
  const { scene, materials } = useMemo(() => {
    const scene = asset.scene.clone(true);
    const materials = new Map<Material, Material>();
    const copyMaterial = (original: Material) => {
      let copy = materials.get(original);
      if (!copy) {
        copy = lowPower && original instanceof MeshStandardMaterial
          ? new MeshBasicMaterial({ color: original.color, vertexColors: original.vertexColors, side: original.side, transparent: original.transparent, opacity: original.opacity })
          : original.clone();
        materials.set(original, copy);
      }
      return copy;
    };
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.material = Array.isArray(object.material) ? object.material.map(copyMaterial) : copyMaterial(object.material);
      let source: Object3D | null = object;
      while (source && typeof source.userData.castShadow !== 'boolean') source = source.parent;
      object.castShadow = !lowPower && source?.userData.castShadow === true;
      object.receiveShadow = !lowPower && source?.userData.receiveShadow === true;
      object.frustumCulled = true;
    });
    return { scene, materials };
  }, [asset.scene, lowPower]);

  useEffect(() => {
    onReady();
    return () => materials.forEach((material) => material.dispose());
  }, [materials, onReady]);

  return <>
    {interactive ? <BuildingPicker><primitive object={scene} dispose={null} /></BuildingPicker> : <primitive object={scene} dispose={null} />}
    <SelectionMarker model={scene} />
  </>;
}

function CameraRig({ focusCour, navigation }: { focusCour: boolean; navigation?: MapNavigation }) {
  const controls = useRef<OrbitControlsType>(null);
  const { camera, size, invalidate, gl } = useThree();
  const preference = useAppStore((state) => state.mapMode);
  const mode = navigation?.picking ? '2d' : preference;
  const command = useMapStore((state) => state.cameraCommand);
  const lastCommand = useRef(command.sequence);
  const lastNavigationFocus = useRef('');
  const reset = useCallback(() => {
    if (!(camera instanceof OrthographicCamera) || !controls.current || !size.height) return;
    stopCameraMotion(controls.current, camera);
    const center = new Vector3(modelManifest.center.x, 0, modelManifest.center.z);
    controls.current.target.copy(center);
    camera.position.copy(center).add(mode === '2d' ? new Vector3(0, 680, 0.01) : new Vector3(370, 510, 440));
    camera.lookAt(center);
    camera.left = -260 * size.width / size.height;
    camera.right = -camera.left;
    camera.top = 260;
    camera.bottom = -260;
    camera.updateMatrixWorld();
    const { minX, maxX, minZ, maxZ } = modelManifest.bounds;
    const projectedBounds = new Box3(new Vector3(minX, -6, minZ), new Vector3(maxX, 18, maxZ)).applyMatrix4(camera.matrixWorldInverse);
    const extent = projectedBounds.getSize(new Vector3());
    camera.zoom = 0.85 * Math.min((camera.right - camera.left) / extent.x, 520 / extent.y);
    controls.current.minZoom = camera.zoom * 0.55;
    controls.current.maxZoom = camera.zoom * 7;
    camera.updateProjectionMatrix();
    controls.current.update();
    invalidate();
  }, [camera, invalidate, mode, size.width, size.height]);

  useLayoutEffect(reset, [reset]);

  const performCommand = useCallback((type: string) => {
    const orbit = controls.current;
    if (!orbit || !(camera instanceof OrthographicCamera)) return;
    if (type === 'reset') { reset(); return; }
    stopCameraMotion(orbit, camera);
    if (type === 'cour-rouge') {
      const [x, z] = courRougePosition([modelManifest.origin.longitude, modelManifest.origin.latitude]);
      const target = new Vector3(x, 0, z);
      camera.position.add(target.clone().sub(orbit.target));
      orbit.target.copy(target);
      camera.zoom = Math.max(orbit.minZoom, Math.min(orbit.maxZoom, Math.min(camera.right - camera.left, camera.top - camera.bottom) / 130));
      camera.updateProjectionMatrix();
    }
    if (type === 'route' && navigation?.route) {
      const bounds = new Box3().setFromPoints(navigation.route.points.map(([x, z]) => new Vector3(x, 0, z)));
      bounds.expandByVector(new Vector3(12, 5, 12));
      const center = bounds.getCenter(new Vector3());
      center.y = 0;
      camera.position.add(center.clone().sub(orbit.target));
      orbit.target.copy(center);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      const extent = bounds.clone().applyMatrix4(camera.matrixWorldInverse).getSize(new Vector3());
      const portraitPhone = size.width <= 760;
      const heightFraction = portraitPhone ? Math.max(.35, (size.height - 370) / size.height) : .78;
      camera.zoom = Math.max(orbit.minZoom, Math.min(orbit.maxZoom, .86 * (camera.right - camera.left) / extent.x, heightFraction * (camera.top - camera.bottom) / extent.y));
      camera.updateProjectionMatrix();
      // Keep the route between the turn card and the bottom card on a phone.
      if (portraitPhone) {
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        up.y = 0;
        const shift = up.multiplyScalar(-45 * (camera.top - camera.bottom) / (camera.zoom * size.height * up.lengthSq()));
        camera.position.add(shift);
        orbit.target.add(shift);
      }
    }
    if (type === 'position' && navigation?.position) {
      const center = new Vector3(navigation.position[0], 0, navigation.position[1]);
      camera.position.add(center.clone().sub(orbit.target));
      orbit.target.copy(center);
      if (!navigation.route) camera.zoom = Math.max(orbit.minZoom, Math.min(orbit.maxZoom, 3));
      camera.updateProjectionMatrix();
    }
    if (type === 'zoom-in' || type === 'zoom-out') {
      camera.zoom = Math.max(orbit.minZoom, Math.min(orbit.maxZoom, camera.zoom * (type === 'zoom-in' ? 1.25 : 0.8)));
      camera.updateProjectionMatrix();
    }
    if (type === 'north') {
      const offset = camera.position.clone().sub(orbit.target);
      camera.position.set(orbit.target.x, orbit.target.y + offset.y, orbit.target.z + Math.hypot(offset.x, offset.z));
    }
    orbit.update();
    invalidate();
  }, [camera, invalidate, reset, navigation, size.width, size.height]);

  useEffect(() => { if (focusCour) performCommand('cour-rouge'); }, [focusCour, performCommand]);

  // A preview must not move the map under the finger placing the next point.
  const navigationFocus = navigation ? `${navigation.fitKey}:${navigation.picking}:${!navigation.picking && Boolean(navigation.route)}:${mode}:${size.width}:${size.height}` : '';
  useEffect(() => {
    if (!navigation || navigationFocus === lastNavigationFocus.current) return;
    lastNavigationFocus.current = navigationFocus;
    if (!navigation.picking && navigation.route) performCommand('route');
    else if (navigation.position) performCommand('position');
  }, [navigation, navigationFocus, performCommand]);

  useEffect(() => {
    if (command.sequence === lastCommand.current) return;
    lastCommand.current = command.sequence;
    performCommand(command.type);
  }, [command, performCommand]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !controls.current) return;
      const commands: Record<string, string> = { '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', Home: 'reset', n: 'north' };
      if (commands[event.key]) {
        event.preventDefault();
        performCommand(commands[event.key]);
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        if (camera instanceof OrthographicCamera) stopCameraMotion(controls.current, camera);
        const distance = 16 / camera.zoom;
        const offset = new Vector3(event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0, 0, event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0);
        controls.current.target.add(offset);
        camera.position.add(offset);
        controls.current.update();
        invalidate();
      }
    };
    const onPointerDown = () => canvas.focus({ preventScroll: true });
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { canvas.removeEventListener('keydown', onKeyDown); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [camera, gl, invalidate, performCommand]);

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.09} enableRotate={mode === '3d'} screenSpacePanning={false} minPolarAngle={0.00001} maxPolarAngle={Math.PI / 2.35} touches={{ ONE: mode === '2d' ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }} mouseButtons={{ LEFT: mode === '2d' ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} onChange={() => {
    if (controls.current) {
      const heading = Math.round(controls.current.getAzimuthalAngle() * 180 / Math.PI);
      if (heading !== useMapStore.getState().heading) useMapStore.getState().setHeading(heading);
    }
  }} />;
}

function ContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const onContextLost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', onContextLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', onContextLost);
  }, [gl, onLost]);
  return null;
}

export default function Map3D({ focusCour = false, onFocusCour, navigation, fallback }: { focusCour?: boolean; onFocusCour: () => void; navigation?: MapNavigation; fallback?: ReactNode }) {
  const lowPower = useAppStore((state) => state.lowPower);
  const progress = useMapStore((state) => state.modelProgress);
  const theme = useResolvedTheme();
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onReady = useCallback(() => setReady(true), []);
  const onLost = useCallback(() => setLost(true), []);
  const retry = () => {
    useLoader.clear(GLTFLoader, MODEL_URL);
    useMapStore.getState().setModelProgress(0);
    setReady(false);
    setLost(false);
    setAttempt((current) => current + 1);
  };

  if (lost) return <MapUnavailable onRetry={retry} fallback={fallback} />;
  return <MapBoundary key={attempt} onRetry={retry} fallback={fallback}>
    <div className="nav-canvas-host" data-testid="navigator-map" data-state={ready ? 'ready' : 'loading'} data-quality={lowPower ? 'low' : 'standard'}>
      <p id="canvas-instructions" className="sr-only">Carte 3D : flèches pour déplacer, plus et moins pour zoomer, touche Début pour recentrer. La recherche et le plan accessible sont disponibles au-dessus de la carte.</p>
      <Canvas orthographic camera={{ position: [370, 510, 440], near: 1, far: 2000 }} dpr={lowPower ? 1 : [1, 1.75]} frameloop="demand" shadows={!lowPower} gl={{ antialias: true, powerPreference: lowPower ? 'low-power' : 'default' }} fallback={<p>Carte 3D indisponible. <a href="/explore">Ouvrir le plan accessible</a></p>} onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace;
        gl.toneMappingExposure = 0.92;
        gl.domElement.tabIndex = 0;
        gl.domElement.setAttribute('aria-label', 'Carte 3D de la Faculté des Sciences de Monastir');
        gl.domElement.setAttribute('aria-describedby', 'canvas-instructions');
      }}>
        <color attach="background" args={[theme === 'dark' ? '#17241f' : '#eff1e8']} />
        <hemisphereLight args={['#fffdf5', '#9aab8d', 1.65]} />
        <directionalLight color="#fff2dc" intensity={2.1} position={[-180, 340, -90]} castShadow={!lowPower} shadow-mapSize={[1024, 1024]} shadow-camera-left={-340} shadow-camera-right={340} shadow-camera-top={340} shadow-camera-bottom={-340} shadow-camera-near={1} shadow-camera-far={850} shadow-normalBias={0.12} shadow-bias={-0.00015} />
        <ContextGuard onLost={onLost} />
        <CameraRig focusCour={focusCour} navigation={navigation} />
        <Suspense fallback={null}><CampusAsset onReady={onReady} interactive={!navigation} /></Suspense>
        <CampusLabels onFocusCour={onFocusCour} navigation={navigation} />
        {navigation && <NavigationScene navigation={navigation} />}
      </Canvas>
      {!ready && <MapLoading progress={progress} />}
    </div>
  </MapBoundary>;
}
