import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, CalendarDays, CalendarPlus, DoorOpen, ExternalLink, Layers3, Navigation, Ruler, X } from 'lucide-react';
import type { CampusBuilding, MappedRoom, ScheduledClass } from '../../data/types';
import { campusData, CATEGORY_LABEL, SIDE_LABEL, floorLabel, floorsLabel, floorsSourceLabel } from '../../lib/campus-catalog';
import { CATEGORY_META } from '../../lib/campus';
import { useMapStore } from '../../store/useAppStore';
import { scheduleAddUrl, scheduleDaysLabel, scheduleEditUrl, scheduleTitle } from '../../lib/schedule';
import { navigationUrl } from '../../lib/navigation-destinations';

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const BuildingPlan2D = lazy(() => import('../BuildingPlan2D'));

const roomTypeLabel = (type: string) =>
  type === 'library' ? 'Bibliothèque' : type === 'toilets' ? 'Sanitaires' : type === 'amphitheatre' ? 'Amphithéâtre' : type === 'classroom' ? 'Salle de cours' : 'Salle';

const RoomIcon = ({ type }: { type: string }) => type === 'library' ? <BookOpen size={16} /> : <DoorOpen size={16} />;

function RoomGroup({ title, rooms }: { title: string; rooms: MappedRoom[] }) {
  if (!rooms.length) return null;
  return (
    <section className="nav-building-room-group" aria-label={title || 'Salles'}>
      {title && <h4>{title}</h4>}
      <ul>
        {rooms.map((room) => (
          <li key={room.id}>
            <RoomIcon type={room.type} />
            <span><strong>{room.name}</strong><small>{roomTypeLabel(room.type)} · {floorsLabel(room.floors)}</small></span>
            <Link className="nav-room-route" to={navigationUrl(`room:${room.id}`)} aria-label={`Itinéraire vers ${room.name}`}><Navigation size={17} /></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function BuildingSheet({ building, personalClass, onClose, onFocusCour }: { building: CampusBuilding; personalClass?: ScheduledClass; onClose: () => void; onFocusCour: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The sheet is non-modal: the map and search remain usable while it is open.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('canvas, #nav-building-input')?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [building.id, personalClass?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape handled inside the search field is consumed by the search.
      if (event.target instanceof Element && event.target.closest('.nav-building-search, dialog[open]')) return;
      if (useMapStore.getState().searchOpen) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const category = CATEGORY_META[building.category];
  const hasSides = building.rooms.some((room) => room.side);

  return (
    <aside className="nav-building-sheet" role="region" aria-labelledby="nav-building-sheet-title" data-building-id={building.id}>
      <header className="nav-building-sheet-head">
        <span className="nav-building-chip"><i style={{ backgroundColor: category.color }} />{CATEGORY_LABEL[building.category]}</span>
        <button type="button" className="nav-icon-button" onClick={onClose} aria-label="Fermer les détails"><X size={20} /></button>
      </header>

      <div className="nav-building-sheet-scroll" ref={scrollRef}>
        <h2 id="nav-building-sheet-title" ref={headingRef} tabIndex={-1}>{building.name}</h2>
        <p className="nav-building-subtitle">Repère {building.shortCode} · {campusData.name}</p>
        <Link className="nav-primary-button nav-building-route-button" to={navigationUrl(personalClass ? `course:${personalClass.id}` : `building:${building.id}`)}><Navigation size={17} />{personalClass ? 'Me guider vers ce cours' : 'Me guider ici'}</Link>

        {personalClass && <section className="nav-building-personal" aria-label="Votre cours dans ce bâtiment">
          <span className="nav-eyebrow">VOTRE COURS</span><h3>{scheduleTitle(personalClass)}</h3>
          {personalClass.label && <p>{personalClass.title}</p>}
          <p><strong>{personalClass.room}</strong> · {floorLabel(personalClass.floor)}</p>
          <p>{scheduleDaysLabel(personalClass.days)} · {personalClass.startTime}–{personalClass.endTime}</p>
          <Link className="nav-text-button" to={scheduleEditUrl(personalClass.id)}>Modifier ce cours</Link>
        </section>}

        <Suspense fallback={<p className="nav-building-fine" role="status">Chargement du plan 2D…</p>}>
          <BuildingPlan2D buildingId={building.id} initialCourseId={personalClass?.id} onFocusCour={onFocusCour} />
        </Suspense>

        <div className="nav-building-metrics">
          <div><Ruler size={15} /><strong>{numberFormat.format(building.footprintArea)} <small>m²</small></strong><span>Emprise</span></div>
          <div><Layers3 size={15} /><strong>{building.floors} <small>{building.floors > 1 ? 'niveaux' : 'niveau'}</small></strong><span>{floorsSourceLabel[building.floorsSource]}</span></div>
        </div>

        <p className="nav-building-height">
          <strong>Hauteur {building.heightEstimated ? 'estimée' : 'OSM'} : {numberFormat.format(building.height)} m</strong>
          <span>{building.heightEstimated ? 'Estimation à 3,5 m par niveau, non relevée sur site.' : 'Hauteur issue d’OpenStreetMap.'}</span>
        </p>

        {building.aliases.length > 0 && <p className="nav-building-aliases"><strong>Aussi appelé :</strong> {building.aliases.join(' · ')}</p>}
        {building.notes.map((note) => <p className="nav-building-note" key={note}>{note}</p>)}

        <section className="nav-building-rooms" aria-labelledby={`rooms-${building.id.replace('/', '-')}`}>
          <h3 id={`rooms-${building.id.replace('/', '-')}`}>Espaces cartographiés{building.rooms.length > 0 && ` · ${building.rooms.length}`}</h3>
          {building.rooms.length ? (
            <>
              {building.rooms.some((room) => room.floors.length > 1) && <p className="nav-building-fine">Un espace sur plusieurs niveaux n’est compté qu’une fois.</p>}
              {hasSides ? <>
                <RoomGroup title={SIDE_LABEL.front} rooms={building.rooms.filter((room) => room.side === 'front')} />
                <RoomGroup title={SIDE_LABEL.rear} rooms={building.rooms.filter((room) => room.side === 'rear')} />
                <RoomGroup title="Autres espaces" rooms={building.rooms.filter((room) => !room.side)} />
              </> : <RoomGroup title="" rooms={building.rooms} />}
            </>
          ) : (
            <p className="nav-building-empty-note">Aucune salle cartographiée pour ce bâtiment.</p>
          )}
        </section>

        <section className="nav-building-classes" aria-label="Cours">
          <h3>Cours</h3>
          {building.classes.length ? <ul className="nav-class-list">{building.classes.map((course) => <li key={course.code}><strong>{course.code} · {course.title}</strong><span>{course.room} · {floorLabel(course.floor)}</span><Link className="nav-text-button" to={scheduleAddUrl(building.id, course.code)} aria-label={`Ajouter ${course.title} au planning`}>Ajouter au planning<CalendarPlus size={15} /></Link></li>)}</ul> : <>
            <p className="nav-building-empty-note"><CalendarDays size={15} />Aucun cours publié pour l’instant.</p>
            <p className="nav-building-fine">Les espaces cartographiés ne sont pas des cours. Le vrai catalogue reste à renseigner ; vous pouvez déjà ajouter vos propres cours au planning.</p>
          </>}
          <Link className="nav-building-secondary-link nav-building-add-course" to={scheduleAddUrl(building.id)}><CalendarPlus size={16} />Ajouter un cours ici</Link>
        </section>

        <details className="nav-building-entrances">
          <summary><DoorOpen size={17} />Entrées cartographiées · {building.entrances.length}</summary>
          <p className="nav-building-fine">Association cartographique uniquement. Ouverture et accessibilité à vérifier sur place.</p>
          {building.entrances.length ? <ul>{building.entrances.map((entrance) => <li key={entrance.id}><strong>{entrance.name}</strong><span>{entrance.side && `${SIDE_LABEL[entrance.side]} · `}{floorsLabel(entrance.floors)} · {entrance.verified ? 'Accès vérifié' : 'Accès non vérifié'}</span></li>)}</ul> : <p className="nav-building-empty-note">Aucune entrée rattachée avec certitude. Cela ne signifie pas que ce bâtiment est inaccessible.</p>}
        </details>

        <div className="nav-building-actions">
          <Link className="nav-primary-button" to={`/explore?building=${encodeURIComponent(building.id)}`}>Voir dans le plan détaillé<ExternalLink size={16} /></Link>
          <a className="nav-building-secondary-link" href={`https://www.openstreetmap.org/${building.id}`} target="_blank" rel="noreferrer">Source OpenStreetMap<ArrowUpRight size={15} /></a>
        </div>
      </div>

      <footer className="nav-building-sheet-foot">
        <a href={campusData.source.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a>
        <span>Projet indépendant, sans affiliation officielle</span>
      </footer>
    </aside>
  );
}
