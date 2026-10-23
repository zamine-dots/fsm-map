import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { CampusViewer, type ViewSnapshot } from '../lib/viewer';
import { CATEGORY_META, polygonsOf, type CampusModel, type CategoryFilter, type MapLayers, type Polygon } from '../lib/campus';
import { COUR_ROUGE, courRougePosition } from '../lib/campus-landmarks';
import CourtyardSurface from './CourtyardSurface';

interface Props {
  model: CampusModel;
  viewerRef: MutableRefObject<CampusViewer | null>;
  selectedId: string | null;
  selectedRoom: string | null;
  indoor: boolean;
  floor: number;
  layers: MapLayers;
  filter: CategoryFilter;
  mode: '2d' | '3d';
  orbit: boolean;
  onSelect: (id: string | null) => void;
  onSelectRoom: (id: string) => void;
  onView: (heading: number, scalePixels: number) => void;
  onFallback: () => void;
}

const pathOf = (polygon: Polygon) => polygon.map((ring) => ring.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]},${point[1]}`).join(' ') + ' Z').join(' ');

function FallbackMap({ model, onSelect, selectedId, layers, indoor, floor, selectedRoom, onSelectRoom }: Pick<Props, 'model' | 'onSelect' | 'selectedId' | 'layers' | 'indoor' | 'floor' | 'selectedRoom' | 'onSelectRoom'>) {
  const rooms = indoor ? model.campusBuildings.find((building) => building.id === selectedId)?.rooms.filter((room) => room.levels.includes(floor)) ?? [] : [];
  const [courX, courZ] = courRougePosition(model.data.metadata.origin);
  return (
    <div className="fallback-map">
      <svg viewBox="-245 -245 490 490" role="img" aria-label="Plan 2D accessible du campus de la FSM">
        <rect x="-250" y="-250" width="500" height="500" rx="12" fill="#e4e7da" />
        <path d={pathOf(model.boundary)} fill="#e8e4d2" stroke={layers.boundary ? '#b8af90' : 'none'} strokeDasharray="3 3" />
        <CourtyardSurface origin={model.data.metadata.origin} />
        {model.features.filter((feature) => ['garden', 'path', 'road'].includes(feature.properties.kind)).map((feature) => {
          if (feature.properties.kind === 'garden' && !layers.greenery) return null;
          if (feature.properties.kind === 'path' && !layers.paths) return null;
          if (feature.geometry.type === 'LineString') return <polyline key={feature.id} points={feature.geometry.coordinates.map((point) => point.join(',')).join(' ')} fill="none" stroke={feature.properties.kind === 'path' ? '#cec0a1' : '#bac0b3'} strokeWidth={feature.properties.kind === 'path' ? 2 : 5} />;
          return polygonsOf(feature.geometry).map((polygon, index) => <path key={`${feature.id}-${index}`} d={pathOf(polygon)} fill={feature.properties.kind === 'garden' ? '#b7ca9b' : '#d2b797'} />);
        })}
        {layers.buildings && model.buildings.map((building) => <g key={building.id}>
          {building.polygons.map((polygon, index) => <path
            key={index}
            d={pathOf(polygon)}
            fill={selectedId === building.id ? (indoor ? '#f2e8d0' : '#d5a365') : CATEGORY_META[building.category].roof}
            stroke={selectedId === building.id ? '#b67732' : '#9da28c'}
            strokeWidth={0.7}
            fillRule="evenodd"
            role={building.campus && !building.roof ? 'button' : undefined}
            tabIndex={building.campus && !building.roof ? 0 : undefined}
            aria-label={building.name}
            onClick={() => building.campus && !building.roof && onSelect(building.id)}
            onKeyDown={(event) => { if (building.campus && !building.roof && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(building.id); } }}
          />)}
        </g>)}
        {layers.buildings && rooms.flatMap((room) => room.polygons.map((polygon, index) => <path key={`${room.id}-${index}`} d={pathOf(polygon)} fill={selectedRoom === room.id ? '#cf9452' : '#b5d4c2'} stroke="#fffff5" strokeWidth={0.6} fillRule="evenodd" role="button" tabIndex={0} aria-label={`Salle ${room.name}`} onClick={() => onSelectRoom(room.id)} onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelectRoom(room.id); } }} />))}
        {layers.buildings && layers.labels && model.campusBuildings.filter((building) => building.named && (building.category === 'department' || building.id === selectedId)).map((building) => <text key={`label-${building.id}`} x={building.center[0]} y={building.center[1]} textAnchor="middle" fontSize={4} fill="#3d5b37" stroke="#fffff4" strokeWidth={1.2} paintOrder="stroke" pointerEvents="none">{building.shortName}</text>)}
        {layers.labels && <text x={courX} y={courZ} fontSize={5} fontWeight="700" textAnchor="middle" fill="#75493b" stroke="#fff3e4" strokeWidth={1.5} paintOrder="stroke" pointerEvents="none">{COUR_ROUGE.name}<tspan x={courX} dy="5" fontSize="3.5" fontWeight="500">{COUR_ROUGE.typeLabel}</tspan></text>}
      </svg>
      <div className="fallback-notice"><MapIcon size={16} /><span>Mode 2D · La 3D nécessite WebGL. Les bâtiments restent sélectionnables.</span></div>
    </div>
  );
}

export default function CampusMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const snapshot = useRef<ViewSnapshot>();
  const callbacks = useRef(props);
  const [fallback, setFallback] = useState(false);
  callbacks.current = props;

  useEffect(() => {
    if (!host.current || fallback) return;
    let viewer: CampusViewer;
    try {
      viewer = new CampusViewer(host.current, props.model, {
        select: (id) => callbacks.current.onSelect(id),
        selectRoom: (id) => callbacks.current.onSelectRoom(id),
        view: (heading, scalePixels) => callbacks.current.onView(heading, scalePixels),
        error: () => { setFallback(true); callbacks.current.onFallback(); },
      }, snapshot.current);
      props.viewerRef.current = viewer;
    } catch {
      setFallback(true);
      callbacks.current.onFallback();
      return;
    }
    return () => {
      snapshot.current = viewer.snapshot();
      viewer.dispose();
      props.viewerRef.current = null;
    };
  }, [props.model, props.viewerRef, fallback]);

  useEffect(() => { props.viewerRef.current?.setSelection(props.selectedId); }, [props.model, props.selectedId, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.setLayers(props.layers); }, [props.model, props.layers, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.setFilter(props.filter); }, [props.model, props.filter, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.setMode(props.mode); }, [props.model, props.mode, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.setOrbit(props.orbit); }, [props.model, props.orbit, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.showFloor(props.indoor ? props.selectedId : null, props.floor); }, [props.model, props.indoor, props.selectedId, props.floor, props.viewerRef]);
  useEffect(() => { props.viewerRef.current?.selectRoom(props.selectedRoom); }, [props.model, props.selectedRoom, props.indoor, props.floor, props.viewerRef]);

  return <div className="scene-host" ref={host} data-testid="campus-map">{fallback && <FallbackMap {...props} />}</div>;
}
