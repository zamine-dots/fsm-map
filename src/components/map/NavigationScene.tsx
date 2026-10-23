import { useEffect, useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Coordinate } from '../../lib/campus';
import type { WalkingRoute } from '../../lib/walking-route';

export interface MapNavigation {
  route: WalkingRoute | null;
  position: Coordinate | null;
  accuracy: number | null;
  live: boolean;
  picking: boolean;
  destinationId: string | null;
  /** Changes for a new trip or manual origin, never for each GPS fix. */
  fitKey: string;
  onPick: (point: Coordinate) => void;
}

const point3 = (point: Coordinate): [number, number, number] => [point[0], .35, point[1]];

/** The route uses the same local metres as the existing campus model. */
export default function NavigationScene({ navigation }: { navigation: MapNavigation }) {
  const { route, position, accuracy, live, picking } = navigation;
  const segments = useMemo(() => ({
    paths: route?.legs.filter((leg) => leg.kind !== 'connection').flatMap((leg) => [point3(leg.from), point3(leg.to)]) ?? [],
    connections: route?.legs.filter((leg) => leg.kind === 'connection').flatMap((leg) => [point3(leg.from), point3(leg.to)]) ?? [],
  }), [route]);

  return <>
    <LocationPicker enabled={picking} onPick={navigation.onPick} />
    {route && <group name="walking_route" userData={{ destinationId: route.destinationId }}>
      {route.points.length > 1 && <Line points={route.points.map(point3)} color="#fffff8" lineWidth={10} depthTest={false} renderOrder={20} toneMapped={false} />}
      {segments.paths.length > 1 && <Line points={segments.paths} segments color="#286c51" lineWidth={5} depthTest={false} renderOrder={21} toneMapped={false} />}
      {segments.connections.length > 1 && <Line points={segments.connections} segments color="#286c51" lineWidth={5} dashed dashSize={1.1} gapSize={.7} depthTest={false} renderOrder={21} toneMapped={false} />}
      <Html position={[route.endpoint[0], 1, route.endpoint[1]]} center zIndexRange={[6, 5]} style={{ pointerEvents: 'none' }}>
        <span className="journey-map-destination" data-testid="route-3d-destination" aria-label="Entrée du bâtiment">B</span>
      </Html>
    </group>}
    {position && <>
      {live && accuracy !== null && Number.isFinite(accuracy) && <mesh position={[position[0], .2, position[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <circleGeometry args={[Math.max(.5, Math.min(accuracy, 50)), 48]} />
        <meshBasicMaterial color="#3284dd" transparent opacity={.13} depthWrite={false} toneMapped={false} />
      </mesh>}
      <Html position={[position[0], 1.2, position[1]]} center zIndexRange={[8, 7]} style={{ pointerEvents: 'none' }}>
        <span className="journey-map-position" data-testid="position-3d" data-live={live} aria-label={live ? 'Votre position' : 'Point de départ'}><i /><small>{live ? 'Vous' : 'Départ'}</small></span>
      </Html>
    </>}
  </>;
}

/** A tap projects onto the ground. Drags and multi-touch belong to the camera. */
function LocationPicker({ enabled, onPick }: { enabled: boolean; onPick: (point: Coordinate) => void }) {
  const { gl, camera } = useThree();
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const raycaster = new Raycaster();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const point = new Vector3();
    const pointers = new Set<number>();
    let gesture = { x: 0, y: 0, valid: false };
    const place = (x: number, y: number) => {
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2), camera);
      if (raycaster.ray.intersectPlane(ground, point)) pick.current([point.x, point.z]);
    };
    const down = (event: PointerEvent) => {
      if (!pointers.size) gesture = { x: event.clientX, y: event.clientY, valid: event.button === 0 };
      else gesture.valid = false;
      pointers.add(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (pointers.has(event.pointerId) && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.valid = false;
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      move(event);
      pointers.delete(event.pointerId);
      if (!pointers.size && gesture.valid && event.target === canvas) place(event.clientX, event.clientY);
    };
    const cancel = () => { pointers.clear(); gesture.valid = false; };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      place(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    };
    canvas.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    canvas.addEventListener('keydown', key);
    return () => {
      canvas.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      canvas.removeEventListener('keydown', key);
    };
  }, [enabled, gl, camera]);
  return null;
}
