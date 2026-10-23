import { AlertTriangle, ChevronRight, MapPin, Navigation, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ScheduledClass } from '../data/types';
import { findBuilding, floorLabel } from '../lib/campus-catalog';
import { scheduleEditUrl, scheduleMapUrl, scheduleTitle } from '../lib/schedule';
import { navigationUrl } from '../lib/navigation-destinations';

export default function ScheduledClassCard({ course, conflict = false, current = false, onDelete }: {
  course: ScheduledClass; conflict?: boolean; current?: boolean; onDelete?: (course: ScheduledClass) => void;
}) {
  const building = findBuilding(course.buildingId);
  const details = <>
    <div className="nav-session-time"><strong>{course.startTime}</strong><span>{course.endTime}</span></div>
    <div className="nav-session-details">
      {current && <span className="nav-session-live">En cours</span>}
      <h3>{scheduleTitle(course)}</h3>
      {course.label && <p className="nav-session-subject">{course.title}</p>}
      <p className="nav-session-location"><MapPin size={14} /><span>{course.room}{course.floor !== null && ` · ${floorLabel(course.floor)}`}</span></p>
      <p className="nav-session-room">{building?.shortName ?? 'Bâtiment à corriger'}</p>
    </div>
    {building && <ChevronRight className="nav-session-chevron" size={17} />}
  </>;
  return <article className={`nav-session-card${current ? ' is-current' : ''}`} data-course-id={course.id}>
    {building ? <Link className="nav-session-main" to={scheduleMapUrl(course)} aria-label={`Voir ${scheduleTitle(course)} sur la carte`}>{details}</Link> : <div className="nav-session-main">{details}</div>}
    {(conflict || !building) && <p className="nav-session-warning"><AlertTriangle size={14} />{!building ? 'Bâtiment absent du catalogue : modifiez le cours.' : 'Horaire en chevauchement'}</p>}
    <footer className="nav-session-actions">
      {building && <Link className="nav-session-route" to={navigationUrl(`course:${course.id}`)} aria-label={`Itinéraire vers ${scheduleTitle(course)}`}><Navigation size={16} />Y aller</Link>}
      <Link to={scheduleEditUrl(course.id)} aria-label={`Modifier ${scheduleTitle(course)}`} title="Modifier"><Pencil size={17} /></Link>
      {onDelete && <button type="button" onClick={() => onDelete(course)} aria-label={`Supprimer ${scheduleTitle(course)}`} title="Supprimer"><Trash2 size={17} /></button>}
    </footer>
  </article>;
}
