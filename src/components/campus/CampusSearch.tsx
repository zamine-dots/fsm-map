import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { BuildingCategory } from '../../data/types';
import { CATEGORY_FILTER_LABEL, CATEGORY_LABEL, searchCampusBuildings } from '../../lib/campus-catalog';
import { CATEGORY_META } from '../../lib/campus';
import { useMapStore } from '../../store/useAppStore';
import { COUR_ROUGE, matchesCourRouge } from '../../lib/campus-landmarks';

const CATEGORIES: BuildingCategory[] = ['department', 'teaching', 'service', 'life'];
const optionId = (id: string) => `nav-building-option-${id.replace('/', '-')}`;
const isTypingTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

export default function CampusSearch({ directory = false }: { directory?: boolean }) {
  const navigate = useNavigate();
  const searchOpen = useMapStore((state) => state.searchOpen);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<BuildingCategory | 'all'>('all');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const expanded = directory || searchOpen;

  const results = useMemo(() => searchCampusBuildings(query, category), [query, category]);
  const courtyardResult = category === 'all' && matchesCourRouge(query);
  const resultCount = results.length + Number(courtyardResult);
  const activeId = results[active]?.id ?? (courtyardResult ? COUR_ROUGE.id : null);
  const close = () => {
    useMapStore.getState().setSearchOpen(false);
    setActive(0);
  };

  useEffect(() => { setActive(0); }, [query, category]);
  useEffect(() => {
    if (expanded && document.activeElement === inputRef.current && activeId) document.getElementById(optionId(activeId))?.scrollIntoView({ block: 'nearest' });
  }, [activeId, expanded]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target) && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        useMapStore.getState().setSearchOpen(true);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (directory || !useMapStore.getState().searchOpen) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [directory]);

  const select = (id: string) => {
    useMapStore.getState().selectBuilding(id);
    close();
  };
  const selectCourtyard = () => {
    close();
    navigate('/map?landmark=cour-rouge');
    useMapStore.getState().moveCamera('cour-rouge');
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!resultCount) return;
      useMapStore.getState().setSearchOpen(true);
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : resultCount - 1)) % resultCount);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const building = results[active] ?? results[0];
      if (courtyardResult && active === results.length) selectCourtyard();
      else if (building) select(building.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Keep the event inside the search: a sheet must not close on the same press.
      event.stopPropagation();
      if (query) { setQuery(''); return; }
      close();
    }
  };

  return (
    <div className="nav-building-search" ref={rootRef} data-open={expanded} data-directory={directory} onBlur={(event) => {
      if (!directory && !event.currentTarget.contains(event.relatedTarget)) close();
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }}>
      <div className="nav-building-field">
        <Search size={20} aria-hidden />
        <input
          ref={inputRef}
          id="nav-building-input"
          type="search"
          role={directory ? 'searchbox' : 'combobox'}
          autoComplete="off"
          spellCheck={false}
          placeholder="Amphi 2, LC1, B27, code de cours…"
          aria-label="Rechercher un bâtiment, une salle ou un cours"
          aria-expanded={directory ? undefined : searchOpen}
          aria-controls={expanded ? 'nav-building-results' : undefined}
          aria-autocomplete={directory ? undefined : 'list'}
          aria-activedescendant={!directory && searchOpen && activeId ? optionId(activeId) : undefined}
          value={query}
          onChange={(event) => { setQuery(event.target.value); useMapStore.getState().setSearchOpen(true); }}
          onFocus={() => useMapStore.getState().setSearchOpen(true)}
          onKeyDown={onInputKeyDown}
        />
        {!directory && searchOpen
          ? <button type="button" className="nav-building-close" onClick={close} aria-label="Fermer la recherche"><X size={16} /></button>
          : <span className="nav-building-shortcut" aria-hidden>/</span>}
      </div>

      {expanded && <div className="nav-building-panel">
        <div className="nav-building-filters" role="group" aria-label="Filtrer par catégorie">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>Tout</button>
          {CATEGORIES.map((value) => (
            <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>{CATEGORY_FILTER_LABEL[value]}</button>
          ))}
        </div>

          <ul className="nav-building-list" id="nav-building-results" role={directory ? 'list' : 'listbox'} aria-label="Lieux du campus">
            {results.map((building, index) => (
              <li key={building.id} role={directory ? undefined : 'presentation'}>
                <button
                  type="button"
                  id={optionId(building.id)}
                  role={directory ? undefined : 'option'}
                  tabIndex={directory ? 0 : -1}
                  aria-selected={directory ? undefined : index === active}
                  data-building-id={building.id}
                  className="nav-building-option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(building.id)}
                >
                  <span className="nav-building-dot" style={{ backgroundColor: CATEGORY_META[building.category].color }} aria-hidden />
                  <span className="nav-building-option-copy">
                    <strong>{building.name}</strong>
                    <small>{building.shortCode} · {CATEGORY_LABEL[building.category]}{building.rooms.length ? ` · ${building.rooms.length} espace${building.rooms.length > 1 ? 's' : ''}` : ''}</small>
                  </span>
                </button>
              </li>
            ))}
            {courtyardResult && <li role={directory ? undefined : 'presentation'}><button type="button" id={optionId(COUR_ROUGE.id)} className="nav-building-option" role={directory ? undefined : 'option'} tabIndex={directory ? 0 : -1} aria-selected={directory ? undefined : active === results.length} data-place-kind="courtyard" onMouseEnter={() => setActive(results.length)} onClick={selectCourtyard}>
              <MapPin size={18} /><span className="nav-building-option-copy"><strong>{COUR_ROUGE.name}</strong><small>{COUR_ROUGE.typeLabel} · Repère du campus</small></span>
            </button></li>}
          </ul>
        {!resultCount && (
          <div className="nav-building-empty">
            <p>Aucun bâtiment ne correspond à « {query} ».</p>
            <button type="button" onClick={() => { setQuery(''); setCategory('all'); }}>Réinitialiser</button>
          </div>
        )}

        <p className="nav-building-count" aria-live="polite">{results.length} bâtiment{results.length > 1 ? 's' : ''}{courtyardResult && ' · 1 cour extérieure'}</p>
      </div>}
    </div>
  );
}
