import { ArrowRight, CalendarPlus, Clock3, Compass, Layers3, MapPin, Navigation, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { findBuilding, floorLabel } from '../lib/campus-catalog';
import { durationLabel, occurrenceDayLabel, scheduleAddUrl, scheduleEditUrl, scheduleMapUrl, scheduleTitle, type ClassOccurrence } from '../lib/schedule';
import { navigationUrl } from '../lib/navigation-destinations';

export default function NextClassCard({ occurrence }: { occurrence: ClassOccurrence | null }) {
  if (!occurrence) return <section className="nav-next-card nav-next-empty" aria-labelledby="next-class-title">
    <span className="nav-next-empty-icon"><Compass size={31} strokeWidth={1.5} /></span>
    <h2 id="next-class-title">Aucun cours ajouté</h2>
    <Link className="nav-primary-button" to={scheduleAddUrl()}><CalendarPlus size={18} />Ajouter mon premier cours<ArrowRight size={17} /></Link>
  </section>;

  const { course } = occurrence;
  const building = findBuilding(course.buildingId);
  return <section className="nav-next-card" aria-labelledby="next-class-title" data-current={occurrence.current}>
    <div className="nav-next-topline"><span className="nav-next-status"><i />{occurrence.current ? 'En cours maintenant' : 'Prochain cours'}</span><span className="nav-countdown">{occurrence.current ? 'Encore' : 'Dans'} {durationLabel(occurrence.current ? occurrence.endsInMinutes : occurrence.startsInMinutes)}</span></div>
    <p className="nav-next-date">{occurrenceDayLabel(occurrence)} · {course.startTime}–{course.endTime}</p>
    <h2 id="next-class-title">{scheduleTitle(course)}</h2>
    {(course.label || course.catalogCode) && <p className="nav-next-subject">{course.catalogCode && `${course.catalogCode} · `}{course.title}</p>}
    <dl className="nav-next-details">
      <div><MapPin size={18} /><dt className="sr-only">Bâtiment</dt><dd>{building ? `${building.shortCode} · ${building.name}` : 'Bâtiment absent du catalogue'}</dd></div>
      <div><Layers3 size={18} /><dt className="sr-only">Salle et niveau</dt><dd>{course.room} · {floorLabel(course.floor)}</dd></div>
      <div><Clock3 size={18} /><dt className="sr-only">Horaires</dt><dd>{course.startTime} à {course.endTime}, heure de Monastir</dd></div>
    </dl>
    <div className="nav-next-actions">{building ? <><Link className="nav-primary-button" to={navigationUrl(`course:${course.id}`)}>Me guider vers ce cours<Navigation size={18} /></Link><Link className="nav-text-button" to={scheduleMapUrl(course)}>Voir le bâtiment<ArrowRight size={16} /></Link></> : <Link className="nav-primary-button" to={scheduleEditUrl(course.id)}>Corriger le bâtiment<Pencil size={17} /></Link>}<Link className="nav-text-button" to={scheduleEditUrl(course.id)}>Modifier ce cours</Link></div>
    {!building && <p className="nav-next-footnote">Choisissez le bâtiment de ce cours.</p>}
  </section>;
}
