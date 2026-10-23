import { useEffect, useLayoutEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { EdgesGeometry, Mesh, type BufferGeometry, type Matrix4, type Object3D } from 'three';
import { CATEGORY_META } from '../../lib/campus';
import { buildingNodeName, findBuilding } from '../../lib/campus-catalog';
import { useMapStore } from '../../store/useAppStore';

const EDGE_COLOR = '#e3a52e';

interface EdgePart { geometry: BufferGeometry; matrix: Matrix4 }

/**
 * The optimized GLB stores `buildingId` on the glTF node. Because a building is
 * made of several primitives (roof + walls), three.js loads each node as a Group
 * whose child meshes carry empty userData. We therefore resolve the owning node
 * (by extras or by its `building_*` name) and build edges for every mesh beneath
 * it. The meshes are meshopt-quantized: `applyMatrix4` would truncate the
 * normalized integer positions in place, so we keep the edges in local space and
 * carry the owning mesh's world matrix instead.
 */
function owningNodes(scene: Object3D, id: string): Object3D[] {
  const expectedName = buildingNodeName(id);
  const owners: Object3D[] = [];
  scene.traverse((object) => {
    const dataId = object.userData?.buildingId;
    if ((typeof dataId === 'string' && dataId === id) || object.name === expectedName) owners.push(object);
  });
  return owners;
}

export default function SelectionMarker({ model }: { model: Object3D }) {
  const selectedId = useMapStore((state) => state.selectedBuildingId);
  const { invalidate } = useThree();
  const building = findBuilding(selectedId);
  const [edges, setEdges] = useState<EdgePart[]>([]);

  useLayoutEffect(() => {
    const result: EdgePart[] = [];
    if (selectedId) {
      const meshes = new Set<Mesh>();
      for (const owner of owningNodes(model, selectedId)) {
        owner.traverse((object) => { if (object instanceof Mesh) meshes.add(object); });
      }
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false);
        result.push({ geometry: new EdgesGeometry(mesh.geometry, 28), matrix: mesh.matrixWorld.clone() });
      }
    }
    setEdges(result);
    return () => result.forEach((part) => part.geometry.dispose());
  }, [model, selectedId]);

  // Demand rendering: draw the newly mounted outlines after they commit.
  useEffect(() => { invalidate(); }, [edges, invalidate]);

  if (!building) return null;
  const radius = Math.max(5, Math.min(55, Math.sqrt(building.footprintArea / Math.PI) * 0.7));
  return (
    <group renderOrder={20}>
      {edges.map((part, index) => (
        <lineSegments key={index} geometry={part.geometry} matrix={part.matrix} matrixAutoUpdate={false} renderOrder={20}>
          <lineBasicMaterial color={EDGE_COLOR} depthWrite={false} depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      ))}
      <mesh position={[building.position.x, 0.12, building.position.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[radius * 0.9, radius, 64]} />
        <meshBasicMaterial color={CATEGORY_META[building.category].color} depthWrite={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}
