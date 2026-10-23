import { Html } from '@react-three/drei';
import { campusBuildings, campusData } from '../../lib/campus-catalog';
import { COUR_ROUGE, courRougePosition } from '../../lib/campus-landmarks';
import { useAppStore, useMapStore } from '../../store/useAppStore';
import type { MapNavigation } from './NavigationScene';

/** The five catalog landmarks replace the generated manifest labels. */
export default function CampusLabels({ onFocusCour, navigation }: { onFocusCour: () => void; navigation?: MapNavigation }) {
  const labels = useAppStore((state) => state.labels);
  if (!labels) return null;
  const [courX, courZ] = courRougePosition([campusData.coordinates.origin.lng, campusData.coordinates.origin.lat]);
  return <>
    {(!navigation?.position || Math.hypot(navigation.position[0] - courX, navigation.position[1] - courZ) > 16) && <Html position={[courX, 3, courZ]} center zIndexRange={[4, 1]} className="nav-landmark-anchor" style={navigation ? { pointerEvents: 'none' } : undefined}>
      {navigation ? <span className="nav-map-label nav-cour-label" style={{ pointerEvents: 'none' }}>{COUR_ROUGE.name}<small>{COUR_ROUGE.typeLabel}</small></span> : <button type="button" className="nav-map-label nav-cour-label" onClick={onFocusCour} aria-label="Centrer sur Cour Rouge" title={COUR_ROUGE.typeLabel}>{COUR_ROUGE.name}<small>{COUR_ROUGE.typeLabel}</small></button>}
    </Html>}
    {campusBuildings.filter((building) => building.landmark && building.id !== navigation?.destinationId).map((building) => (
      <Html
        key={building.id}
        position={[building.position.x, building.height + 5, building.position.z]}
        center
        zIndexRange={[4, 1]}
        className={`nav-landmark-anchor ${building.landmark === 'secondary' ? 'nav-landmark-secondary' : ''}`}
        style={navigation ? { pointerEvents: 'none' } : undefined}
      >
        {navigation ? <span className="nav-map-label" style={{ pointerEvents: 'none' }}>{building.shortName}</span> : <button
          type="button"
          className="nav-map-label"
          onClick={() => useMapStore.getState().selectBuilding(building.id)}
          aria-label={`Détails : ${building.name}`}
        >
          {building.shortName}
        </button>}
      </Html>
    ))}
  </>;
}
