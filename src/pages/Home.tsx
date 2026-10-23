import { useMemo } from 'react';
import { ArrowRight, BookOpen, CalendarPlus, Clock3, Navigation, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import NextClassCard from '../components/NextClassCard';
import ScheduledClassCard from '../components/ScheduledClassCard';
import ScheduleStorageNotice from '../components/ScheduleStorageNotice';
import { campusData } from '../lib/campus-catalog';
import { conflictingIdsForDay, getScheduleOverview, scheduleAddUrl } from '../lib/schedule';
import { useNow } from '../lib/useNow';
import { useScheduleStore } from '../store/useScheduleStore';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: campusData.timezone, weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: campusData.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export default function HomePage() {
  const navigate = useNavigate();
  const classes = useScheduleStore((state) => state.classes);
  const now = useNow();
  const overview = useMemo(() => getScheduleOverview(classes, now, campusData.timezone), [classes, now]);
  const conflicts = useMemo(() => conflictingIdsForDay(classes, overview.clock.weekday), [classes, overview.clock.weekday]);
  const remaining = overview.today.filter((occurrence) => occurrence.course.id !== overview.primary?.course.id);

  return <div className="nav-planning-page nav-home-page">
    <header className="nav-page-heading"><div><span className="nav-eyebrow">VOTRE JOURNÉE À LA FSM</span><h1>On va où, aujourd’hui ?</h1><p className="nav-today-date">{dateFormat.format(now)}</p></div><span className="nav-campus-clock"><Clock3 size={16} /><time dateTime={now.toISOString()}>{timeFormat.format(now)}</time> à Monastir</span></header>
    <form className="nav-home-route-search" role="search" onSubmit={(event) => { event.preventDefault(); const query = String(new FormData(event.currentTarget).get('q') ?? '').trim(); navigate(`/map?${new URLSearchParams({ navigate: '1', ...(query ? { q: query } : {}) })}`); }}>
      <span className="nav-home-route-icon"><Navigation size={25} /></span><div><label htmlFor="home-class-search">Trouver une salle</label></div>
      <div className="nav-home-route-field"><Search size={18} /><input id="home-class-search" name="q" type="search" placeholder="Amphi 2, salle 101, mon cours…" autoComplete="off" /><button type="submit" aria-label="Chercher mon itinéraire"><ArrowRight size={19} /></button></div>
    </form>
    <ScheduleStorageNotice />
    {overview.current.length > 1 && <p className="nav-inline-warning" role="status">{overview.current.length} cours se chevauchent en ce moment. Vérifiez vos horaires : les autres cours en cours figurent dans la liste du jour.</p>}
    <NextClassCard occurrence={overview.primary} />
    <section className="nav-today-section" aria-labelledby="today-courses-title">
      <div className="nav-section-heading"><div><h2 id="today-courses-title">La suite aujourd’hui</h2><p>{remaining.length ? `${remaining.length} autre${remaining.length > 1 ? 's' : ''} cours en cours ou à venir` : 'Aucun autre cours saisi pour aujourd’hui.'}</p></div><Link className="nav-secondary-button" to="/schedule"><BookOpen size={16} />Mon planning</Link></div>
      {remaining.length > 0 && <div className="nav-today-courses">{remaining.map((occurrence) => <ScheduledClassCard key={occurrence.course.id} course={occurrence.course} current={occurrence.current} conflict={conflicts.has(occurrence.course.id)} />)}</div>}
    </section>
    <footer className="nav-planning-footer"><p>Semaine type · les vacances et annulations ne sont pas déduites automatiquement.</p><Link className="nav-text-button" to={scheduleAddUrl()}><CalendarPlus size={16} />Ajouter un cours</Link></footer>
  </div>;
}
