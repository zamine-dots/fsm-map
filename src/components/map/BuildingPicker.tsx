import { useEffect, useRef, type ReactNode } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { Object3D } from 'three';
import { findBuilding } from '../../lib/campus-catalog';
import { useMapStore } from '../../store/useAppStore';

const ID_PATTERN = /^(way|relation)\/\d+$/;
const NODE_PATTERN = /^building_(way|relation)_(\d+)(?:_part_\d+)?$/;

/** First explicit building id wins; otherwise fall back to the model node name. */
export function resolveBuildingId(object: Object3D | null | undefined): string | null {
  let current: Object3D | null | undefined = object;
  while (current) {
    const dataId = current.userData?.buildingId ?? current.userData?.osmId;
    if (typeof dataId === 'string' && ID_PATTERN.test(dataId)) return dataId;
    const match = NODE_PATTERN.exec(current.name ?? '');
    if (match) return `${match[1]}/${match[2]}`;
    current = current.parent;
  }
  return null;
}

/**
 * The GLB also contains neighbouring buildings that are not part of the FSM
 * catalog. Only a catalog building may become a selection, otherwise a tap on a
 * neighbour would write an unrestorable `?building=` deep link.
 */
export function selectableBuildingId(object: Object3D | null | undefined): string | null {
  const id = resolveBuildingId(object);
  return id && findBuilding(id) ? id : null;
}

const DRAG_SLOP = 5;

/**
 * Wraps the loaded campus scene and turns a real tap into a native selection.
 * Selection is purely additive here: no material is mutated, the marker is a
 * separate overlay. A drag past the slop leaves OrbitControls in charge.
 */
export default function BuildingPicker({ children }: { children: ReactNode }) {
  const { gl } = useThree();
  const tapReady = useRef(false);

  useEffect(() => {
    const canvas = gl.domElement;
    const pointers = new Set<number>();
    let gesture = { x: 0, y: 0, valid: false };
    const onDown = (event: PointerEvent) => {
      if (!pointers.size) gesture = { x: event.clientX, y: event.clientY, valid: event.button === 0 };
      else gesture.valid = false;
      pointers.add(event.pointerId);
      tapReady.current = false;
    };
    const onMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId) && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > DRAG_SLOP) gesture.valid = false;
    };
    const onUp = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      onMove(event);
      pointers.delete(event.pointerId);
      tapReady.current = !pointers.size && gesture.valid && event.target === canvas;
    };
    const onCancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      gesture.valid = false;
      tapReady.current = false;
    };
    // Capture every movement, including drags returning to their start and multi-touch gestures.
    canvas.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      canvas.style.cursor = '';
    };
  }, [gl]);

  const isTap = (event: MouseEvent) => event.target === gl.domElement && event.button === 0 && tapReady.current;
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    // The nearest surface consumes the event, even if it is not a campus building.
    event.stopPropagation();
    if (!isTap(event.nativeEvent)) return;
    useMapStore.getState().selectBuilding(selectableBuildingId(event.object));
  };

  return (
    <group
      onClick={onClick}
      onPointerMove={(event) => {
        event.stopPropagation();
        gl.domElement.style.cursor = selectableBuildingId(event.object) ? 'pointer' : '';
      }}
      onPointerOut={() => { gl.domElement.style.cursor = ''; }}
      onPointerMissed={(event) => { if (isTap(event)) useMapStore.getState().selectBuilding(null); }}
    >
      {children}
    </group>
  );
}
