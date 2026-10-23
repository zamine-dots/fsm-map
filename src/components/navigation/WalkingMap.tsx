import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { LocateFixed, Minus, Plus, Scan } from 'lucide-react';
import { boundsOf, polygonsOf, type CampusModel, type Coordinate } from '../../lib/campus';
import { campusBuildings } from '../../lib/campus-catalog';
import { polygonPath } from '../../lib/building-tags';
import { COUR_ROUGE, courRougePosition } from '../../lib/campus-landmarks';
import CourtyardSurface from '../CourtyardSurface';
import { formatDistance, isNearCampus, type WalkNetwork, type WalkingRoute } from '../../lib/walking-route';

type View = { x: number; y: number; width: number; height: number };
const path = (points: Coordinate[]) => points.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ');

export default function WalkingMap({ network, route, position, accuracy, live, selectedBuildingId, picking, onPick, onSelect, onCancelPick }: {
  network: WalkNetwork; route: WalkingRoute | null; position: Coordinate | null; accuracy: number | null; live: boolean;
  selectedBuildingId: string | null; picking: boolean; onPick: (point: Coordinate) => void; onSelect: (id: string) => void; onCancelPick: () => void;
}) {
  const model = network.model;
  const svg = useRef<SVGSVGElement>(null);
  const boundary = useMemo(() => boundsOf(model.boundary[0]), [model]);
  const overview = useMemo<View>(() => ({ x: boundary.minX - 22, y: boundary.minZ - 22, width: boundary.maxX - boundary.minX + 44, height: boundary.maxZ - boundary.minZ + 44 }), [boundary]);
  const [view, setView] = useState(overview);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, moved: false, multi: false });
  const lastDestination = useRef<string | null>(null);
  const visiblePosition = position && (picking || isNearCampus(network, position)) ? position : null;
  const cour = courRougePosition(model.data.metadata.origin);
  const unit = Math.max(view.width / size.width, view.height / size.height) * 7;
  const labelSize = Math.min(5.4, Math.max(view.width, view.height) / 65);

  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);

  const fitRoute = useCallback(() => {
    if (picking || !route) { setView(overview); return; }
    const b = boundsOf(route.points);
    setView({ x: (b.minX + b.maxX) / 2 - Math.max(100, b.maxX - b.minX + 70) / 2, y: (b.minZ + b.maxZ) / 2 - Math.max(100, b.maxZ - b.minZ + 70) / 2, width: Math.max(100, b.maxX - b.minX + 70), height: Math.max(100, b.maxZ - b.minZ + 70) });
  }, [route, overview, picking]);
  useEffect(() => {
    if (!picking && route && route.destinationId !== lastDestination.current) { fitRoute(); lastDestination.current = route.destinationId; }
    if (picking || !route) lastDestination.current = null;
  }, [route, fitRoute, picking]);
  const zoom = (factor: number) => setView((current) => {
    const width = Math.max(55, Math.min(overview.width * 2, current.width * factor));
    const ratio = width / current.width;
    return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - current.height * ratio) / 2, width, height: current.height * ratio };
  });
  const toMap = (clientX: number, clientY: number): Coordinate | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const transformed = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [transformed.x, transformed.y];
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) gesture.current = { x: event.clientX, y: event.clientY, moved: false, multi: false };
    else { gesture.current.multi = true; gesture.current.moved = true; }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const old = pointers.current.get(event.pointerId);
    if (!old) return;
    if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 5) gesture.current.moved = true;
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 0 && after > 0) zoom(before / after);
    } else if (gesture.current.moved) {
      const a = toMap(old.x, old.y), b = toMap(event.clientX, event.clientY);
      if (a && b) setView((current) => ({ ...current, x: current.x + a[0] - b[0], y: current.y + a[1] - b[1] }));
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const clicked = !gesture.current.moved && !gesture.current.multi;
    pointers.current.delete(event.pointerId);
    if (!clicked) return;
    const point = toMap(event.clientX, event.clientY);
    if (!point) return;
    if (picking) { onPick(point); return; }
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-route-building]');
    if (element?.getAttribute('data-route-building')) onSelect(element.getAttribute('data-route-building')!);
  };

  return <div className="route-map-canvas" data-picking={picking}>
    <svg ref={svg} className="route-campus-svg" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="group" tabIndex={0} aria-label="Plan du campus et itinéraire piéton" aria-describedby="route-map-instructions"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }}
      onWheel={(event) => { zoom(event.deltaY > 0 ? 1.12 : 0.89); }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home', 'Enter', 'Escape'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(0.8);
        if (event.key === '-') zoom(1.25);
        if (event.key === 'Home') setView(overview);
        if (event.key === 'Escape') onCancelPick();
        if (event.key === 'Enter' && picking) onPick([view.x + view.width / 2, view.y + view.height / 2]);
        if (event.key.startsWith('Arrow')) setView((current) => ({ ...current, x: current.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * current.width / 15, y: current.y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * current.height / 15 }));
      }}>
      <MapGround model={model} />
      <CourtyardSurface origin={model.data.metadata.origin} />
      <g className="route-paths">{network.segments.map((segment) => <path key={segment.id} d={path([segment.a, segment.b])} />)}</g>
      <g className="route-buildings">{model.buildings.map((building) => <g key={building.id} data-route-building={building.campus && !building.roof ? building.id : undefined}
        role={building.campus && !building.roof ? 'button' : undefined} tabIndex={building.campus && !building.roof ? 0 : undefined}
        aria-label={building.campus && !building.roof ? `Choisir ${campusBuildings.find((entry) => entry.id === building.id)?.name ?? building.name}` : undefined}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (building.campus && !building.roof) onSelect(building.id); } }}
        data-selected={selectedBuildingId === building.id} data-campus={building.campus} data-roof={building.roof}>
        {building.polygons.map((polygon, index) => <path key={index} d={polygonPath(polygon)} fillRule="evenodd" />)}
      </g>)}</g>
      <g className="route-map-labels" pointerEvents="none">{campusBuildings.map((building) => <text key={building.id} x={building.position.x} y={building.position.z + 1} fontSize={labelSize} data-selected={selectedBuildingId === building.id}>{building.shortCode}</text>)}
        <text x={cour[0]} y={cour[1] - unit * 3.4} fontSize={unit * 1.6} className="route-cour-label">{COUR_ROUGE.name}<tspan x={cour[0]} dy={unit * 1.65} fontSize={unit * 1.15}>{COUR_ROUGE.typeLabel}</tspan></text>
      </g>
      {route && <g data-testid="walking-route" fill="none" pointerEvents="none">
        <path d={path(route.points)} className="route-line-halo" vectorEffect="non-scaling-stroke" />
        {route.legs.map((leg, index) => <path key={index} d={path([leg.from, leg.to])} className={`route-line${leg.kind === 'connection' ? ' route-line-connection' : ''}`} data-source={leg.sourceId} vectorEffect="non-scaling-stroke" />)}
        <circle cx={route.endpoint[0]} cy={route.endpoint[1]} r={unit * 1.8} className="route-end-halo" /><circle cx={route.endpoint[0]} cy={route.endpoint[1]} r={unit * 1.1} className="route-end-dot" />
        <text x={route.endpoint[0]} y={route.endpoint[1] + unit * .55} textAnchor="middle" fontSize={unit * 1.6} fill="white" fontWeight="700">B</text>
      </g>}
      {visiblePosition && <g data-testid="walking-position" pointerEvents="none">
        {live && accuracy !== null && Number.isFinite(accuracy) && <circle cx={visiblePosition[0]} cy={visiblePosition[1]} r={Math.min(80, Math.max(0, accuracy))} className="route-accuracy" />}
        <circle cx={visiblePosition[0]} cy={visiblePosition[1]} r={unit * 1.55} fill="white" />
        <circle cx={visiblePosition[0]} cy={visiblePosition[1]} r={unit} className="route-position-dot" />
        <text x={visiblePosition[0]} y={visiblePosition[1] + unit * 3.8} fontSize={unit * 1.8} className="route-position-label">{live ? 'Vous' : 'Départ'}</text>
      </g>}
      {picking && <g className="route-crosshair" pointerEvents="none" transform={`translate(${view.x + view.width / 2} ${view.y + view.height / 2})`}><circle r={unit * 2} /><path d={`M ${-unit * 3} 0 H ${unit * 3} M 0 ${-unit * 3} V ${unit * 3}`} /></g>}
    </svg>
    <p id="route-map-instructions" className="sr-only">Glissez pour déplacer le plan, pincez ou utilisez les boutons pour zoomer. Au clavier : flèches, plus, moins et Début. En mode départ, Entrée place le point au centre du plan. Échap annule.</p>
    <div className="route-map-topline"><span className="route-map-label"><i />{route ? `${route.minutes} min à pied · ${formatDistance(route.distance)}` : live ? 'Position GPS' : 'PLAN DU CAMPUS'}</span><span className="route-north" aria-label="Le nord est en haut">N ↑</span></div>
    <div className="route-map-controls" role="group" aria-label="Commandes du plan">
      <button type="button" aria-label="Zoom avant sur le plan" onClick={() => zoom(0.75)}><Plus size={19} /></button>
      <button type="button" aria-label="Zoom arrière sur le plan" onClick={() => zoom(1.33)}><Minus size={19} /></button>
      <button type="button" aria-label={picking ? 'Voir tout le campus' : 'Voir tout l’itinéraire'} onClick={fitRoute}><Scan size={19} /></button>
      {visiblePosition && <button type="button" aria-label="Centrer sur mon départ" onClick={() => setView((current) => ({ ...current, x: visiblePosition[0] - current.width / 2, y: visiblePosition[1] - current.height / 2 }))}><LocateFixed size={19} /></button>}
    </div>
    {picking && <div className="route-pick-banner" role="status"><span>Touchez une allée pour placer votre départ.</span><button type="button" onClick={onCancelPick}>Annuler</button></div>}
    <div className="route-map-bottom"><span><i />Itinéraire piéton</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap · ODbL</a></div>
  </div>;
}

function MapGround({ model }: { model: CampusModel }) {
  return <g className="route-map-ground" aria-hidden="true">
    <path d={polygonPath(model.boundary)} className="route-boundary" fillRule="evenodd" />
    {model.features.filter((feature) => ['garden', 'parking', 'pitch'].includes(feature.properties.kind)).flatMap((feature) => polygonsOf(feature.geometry).map((polygon, index) => <path key={`${feature.id}-${index}`} d={polygonPath(polygon)} className={`route-ground-${feature.properties.kind}`} fillRule="evenodd" />))}
  </g>;
}
