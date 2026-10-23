import { DoorOpen, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CampusBuilding } from '../../data/types';
import { boundsOf, type CampusModel } from '../../lib/campus';
import { floorLabel, floorsLabel, SIDE_LABEL } from '../../lib/campus-catalog';
import { pointInFootprint, polygonPath } from '../../lib/building-tags';
import type { NavigationDestination } from '../../lib/navigation-destinations';
import type { WalkingRoute } from '../../lib/walking-route';

export default function DestinationArrival({ destination, building, model, route }: { destination: NavigationDestination; building: CampusBuilding; model: CampusModel; route: WalkingRoute | null }) {
  const footprint = model.campusBuildings.find((entry) => entry.id === building.id);
  const room = footprint?.rooms.find((entry) => entry.id === destination.roomId);
  const tag = destination.tag && footprint && pointInFootprint(destination.tag.point, footprint.polygons) ? destination.tag : undefined;
  const bounds = footprint ? boundsOf(footprint.polygons.flatMap((polygon) => polygon[0])) : null;
  const level = destination.floors.length ? floorsLabel(destination.floors) : 'Niveau à préciser sur place';
  const previewRooms = footprint?.rooms.filter((entry) => destination.floors.length !== 1 || entry.levels.includes(destination.floors[0])) ?? [];
  const params = new URLSearchParams({ view: 'list', building: building.id });
  if (destination.courseId) params.set('class', destination.courseId);
  return <section className="route-arrival" aria-label="À votre arrivée">
    <div className="route-arrival-heading"><DoorOpen size={18} /><h3>À votre arrivée</h3></div>
    <p><strong>{destination.roomName ?? building.name}</strong>{destination.kind !== 'building' && <span>{level}{destination.side && ` · ${SIDE_LABEL[destination.side]}`}</span>}</p>
    {(room || tag) && footprint && bounds && <svg viewBox={`${bounds.minX - 5} ${bounds.minZ - 5} ${bounds.maxX - bounds.minX + 10} ${bounds.maxZ - bounds.minZ + 10}`} className="route-arrival-plan" role="img" aria-label={`Repère de ${destination.title} dans le bâtiment${tag ? `, ${floorLabel(tag.floor)}` : ''}`}>
      {footprint.polygons.map((polygon, index) => <path key={index} d={polygonPath(polygon)} fillRule="evenodd" className="route-arrival-footprint" />)}
      {previewRooms.filter((entry) => entry.id !== room?.id).map((entry) => entry.polygons.map((polygon, index) => <path key={`${entry.id}-${index}`} d={polygonPath(polygon)} className="route-arrival-room" fillRule="evenodd" />))}
      {!tag && room?.polygons.map((polygon, index) => <path key={index} d={polygonPath(polygon)} className="route-arrival-selected" fillRule="evenodd" />)}
      {tag && <circle cx={tag.point[0]} cy={tag.point[1]} r="1.5" className="route-arrival-tag" />}
      {route?.entrance && <circle cx={route.entrance.position.x} cy={route.entrance.position.z} r="1.3" className="route-arrival-door" />}
    </svg>}
    {route?.nearby && <p className="route-arrival-note">Entrée à repérer sur place.</p>}
    <Link className="nav-text-button" to={`/map?${params}`}><MapPin size={15} />Ouvrir le plan du bâtiment</Link>
  </section>;
}
