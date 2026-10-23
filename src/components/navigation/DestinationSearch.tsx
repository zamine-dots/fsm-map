import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, Building2, DoorOpen, MapPin, Plus, Search, Tag, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { exactDestinationMatch, searchDestinations, type NavigationDestination } from '../../lib/navigation-destinations';
import { COUR_ROUGE, matchesCourRouge } from '../../lib/campus-landmarks';
import { officialRoomScheduleUrl, officialRoomSource, searchOfficialRooms } from '../../lib/official-rooms';

const icons = { room: DoorOpen, course: BookOpen, building: Building2, tag: Tag, landmark: MapPin };
const courtyardResult = { id: 'landmark:cour-rouge', kind: 'landmark' as const, title: COUR_ROUGE.name, detail: `${COUR_ROUGE.typeLabel} · Repère du campus` };
type SearchResult = NavigationDestination | typeof courtyardResult;

export default function DestinationSearch({ destinations, selected, initialQuery = '', onSelect }: {
  destinations: NavigationDestination[];
  selected: NavigationDestination | null;
  initialQuery?: string;
  onSelect: (destination: NavigationDestination | null) => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery || selected?.title || '');
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const results = useMemo<SearchResult[]>(() => {
    const matches = searchDestinations(query, destinations);
    const exact = matches.filter((entry) => exactDestinationMatch(query, entry));
    return [...(matchesCourRouge(query) ? [courtyardResult] : []), ...(exact.length ? exact : matches)].slice(0, query ? 30 : 12);
  }, [query, destinations]);
  const officialMatches = useMemo(() => results.length ? [] : searchOfficialRooms(query).slice(0, 8), [query, results]);
  const select = (destination: SearchResult) => {
    if (destination.kind === 'landmark') { navigate('/map?landmark=cour-rouge'); return; }
    onSelect(destination); setQuery(destination.title); setActive(0);
    input.current?.blur(); setOpen(false);
  };
  useEffect(() => { setQuery(selected?.title ?? initialQuery); setOpen(true); }, [selected?.id, selected?.title, initialQuery]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (open && results[active]) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, results, id]);
  return <div className="route-destination-search" ref={root}>
    <label className="sr-only" htmlFor={id}>Rechercher une salle ou un cours</label>
    <div className="route-search-field"><Search size={20} aria-hidden />
      <input id={id} ref={input} type="search" role="combobox" value={query} autoComplete="off" autoFocus spellCheck={false} enterKeyHint="search"
        placeholder="Salle, amphi, cours…" aria-label="Rechercher une salle ou un cours"
        aria-expanded={open} aria-controls={open ? `${id}-results` : undefined} aria-autocomplete="list"
        aria-describedby={open && officialMatches.length ? `${id}-official-note` : undefined}
        aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (results.length) setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
          }
          if (event.key === 'Enter') { event.preventDefault(); if (open && results[active]) select(results[active]); }
        }} />
      {query && <button type="button" aria-label="Effacer la destination" onClick={() => { setQuery(''); setOpen(true); onSelect(null); input.current?.focus(); }}><X size={17} /></button>}
    </div>
    {open && <div className="route-search-popover">
      <p className="route-search-caption">{officialMatches.length ? 'Salles du planning officiel' : query ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : 'Salles du campus'}</p>
      <ul id={`${id}-results`} role="listbox" aria-label="Salles, cours, bâtiments et repères">
        {results.map((destination, index) => {
          const Icon = icons[destination.kind];
          return <li key={destination.id} role="presentation"><button id={`${id}-${index}`} type="button" role="option" data-place-kind={destination.kind} tabIndex={-1} aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => select(destination)}>
            <span className="route-result-icon"><Icon size={18} /></span><span><strong>{destination.title}</strong><small>{destination.detail}</small></span>
          </button></li>;
        })}
      </ul>
      {officialMatches.length > 0 && <section className="route-official-rooms" aria-label="Salles du planning officiel">
        <p id={`${id}-official-note`}>Emplacement à confirmer. Ajoutez votre cours en choisissant son bâtiment.</p>
        <ul>{officialMatches.map((room) => <li key={room.id}>
          <div><strong>{room.name}</strong><small>Emplacement à confirmer</small></div>
          <Link to={officialRoomScheduleUrl(room)} aria-label={`Ajouter un cours en ${room.name}`}><Plus size={16} aria-hidden />Planning</Link>
        </li>)}</ul>
        <a className="route-official-source" href={officialRoomSource.url} target="_blank" rel="noreferrer">Voir le planning officiel</a>
      </section>}
      {!results.length && !officialMatches.length && <div className="route-search-empty"><p>Aucun résultat pour « {query} ».</p><Link to="/schedule?add=1">Ajouter mon cours</Link></div>}
    </div>}
  </div>;
}
