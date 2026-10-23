import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Compass, HelpCircle, Layers2, List, LocateFixed, Map as MapIcon, Minus, Plus, Search, SlidersHorizontal } from 'lucide-react';
import AppDialog from '../components/AppDialog';
import BuildingSheet from '../components/campus/BuildingSheet';
import CampusSearch from '../components/campus/CampusSearch';
import CourtyardCard from '../components/campus/CourtyardCard';
import MapLoading from '../components/MapLoading';
import { campusData, campusStats, findBuilding } from '../lib/campus-catalog';
import { useAppStore, useMapStore } from '../store/useAppStore';
import { useScheduleStore } from '../store/useScheduleStore';

const Map3D = lazy(() => import('../components/Map3D'));
const WalkingNavigation = lazy(() => import('./Navigate'));

function NorthControl() {
  const heading = useMapStore((state) => state.heading);
  return <button className="nav-map-button nav-north" type="button" onClick={() => useMapStore.getState().moveCamera('north')} aria-label="Orienter la carte vers le nord" title="Nord en haut"><span>N</span><Compass size={23} style={{ transform: `rotate(${-heading}deg)` }} /></button>;
}

export default function MapPage() {
  const [params] = useSearchParams();
  return params.get('navigate') === '1' ? <Suspense fallback={<MapLoading />}><WalkingNavigation /></Suspense> : <CampusMapPage />;
}

function CampusMapPage() {
  const mode = useAppStore((state) => state.mapMode);
  const labels = useAppStore((state) => state.labels);
  const selectedId = useMapStore((state) => state.selectedBuildingId);
  const [params, setParams] = useSearchParams();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const building = findBuilding(selectedId);
  const syncingFromUrl = useRef(false);
  const listView = params.get('view') === 'list';
  const courFocused = params.get('landmark') === 'cour-rouge';
  const viewParams = new URLSearchParams(params);
  if (listView) viewParams.delete('view');
  else viewParams.set('view', 'list');
  const alternateView = `/map${viewParams.size ? `?${viewParams}` : ''}`;
  const closeBuilding = useCallback(() => useMapStore.getState().selectBuilding(null), []);
  const focusCour = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('building'); next.delete('class'); next.delete('view');
      next.set('landmark', 'cour-rouge');
      return next;
    });
    useMapStore.getState().setSearchOpen(false);
    useMapStore.getState().moveCamera('cour-rouge');
  }, [setParams]);

  const requestedId = courFocused ? null : params.get('building');
  const requestedClassId = params.get('class');
  const personalClass = useScheduleStore((state) => state.classes.find((course) => course.id === requestedClassId && course.buildingId === building?.id));

  // Deep link: /map?building=<id> selects the building, including later history navigations.
  useLayoutEffect(() => {
    syncingFromUrl.current = true;
    useMapStore.getState().selectBuilding(findBuilding(requestedId)?.id ?? null);
    syncingFromUrl.current = false;
  }, [requestedId]);

  // Preserve router history metadata and any view parameters while mirroring map selections.
  useEffect(() => {
    return useMapStore.subscribe((state, previous) => {
      if (syncingFromUrl.current || state.selectedBuildingId === previous.selectedBuildingId) return;
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (state.selectedBuildingId) next.set('building', state.selectedBuildingId);
        else next.delete('building');
        next.delete('class');
        next.delete('landmark');
        return next;
      }, { replace: true });
    });
  }, [setParams]);

  useEffect(() => { useMapStore.getState().setSearchOpen(false); }, [listView]);

  return <section className="nav-map-page" data-view={listView ? 'list' : 'map'} data-selected={Boolean(building)} aria-label="Campus FSM">
    {listView ? <div className="nav-directory">
      <header className="nav-directory-heading">
        <div><h1>Lieux du campus</h1><p>{campusStats.buildings} bâtiments</p></div>
        <Link className="nav-explorer-link" to={alternateView} aria-label="Afficher la carte 3D"><MapIcon size={19} /><span>Vue carte</span></Link>
      </header>
      <CampusSearch directory />
      <p className="nav-fine-print nav-directory-source">Codes courts : repères de l’application, non confirmés comme codes officiels. <a href={campusData.source.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></p>
    </div> : <>
    <div className="nav-scene"><Suspense fallback={<MapLoading />}><Map3D focusCour={courFocused} onFocusCour={focusCour} /></Suspense></div>
    <div className="nav-map-top">
      <Link className="nav-map-search-button" to="/map?navigate=1"><span className="nav-map-search-icon"><Search size={23} /></span><span>Où allez-vous ?</span><ChevronRight size={23} /></Link>
    </div>
    <div className="nav-map-tools" role="group" aria-label="Commandes de la carte">
      <button className="nav-map-button nav-map-view" type="button" onClick={() => useAppStore.getState().setMapMode(mode === '3d' ? '2d' : '3d')} aria-label={mode === '3d' ? 'Afficher en 2D' : 'Afficher en 3D'} title={mode === '3d' ? 'Afficher en 2D' : 'Afficher en 3D'}>{mode.toUpperCase()}</button>
      <button className="nav-map-button" type="button" onClick={() => useMapStore.getState().moveCamera('reset')} aria-label="Recentrer le campus" title="Recentrer"><LocateFixed size={21} /></button>
      <div className="nav-zoom-controls">
        <button className="nav-map-button" type="button" onClick={() => useMapStore.getState().moveCamera('zoom-in')} aria-label="Zoom avant" title="Zoom avant"><Plus size={20} /></button>
        <button className="nav-map-button" type="button" onClick={() => useMapStore.getState().moveCamera('zoom-out')} aria-label="Zoom arrière" title="Zoom arrière"><Minus size={20} /></button>
      </div>
      <button className="nav-map-button" type="button" onClick={() => setOptionsOpen(true)} aria-label="Options de la carte" aria-haspopup="dialog" title="Options"><SlidersHorizontal size={20} /></button>
    </div>
    <div className="nav-map-footer"><a href={campusData.source.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
    </>}
    {requestedId && !findBuilding(requestedId) && <div className="nav-unknown-building" role="status">Ce bâtiment ne figure pas dans le catalogue.<button type="button" onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.delete('building'); next.delete('class'); return next; }, { replace: true })}>Fermer</button></div>}
    {building && !courFocused && <BuildingSheet building={building} personalClass={personalClass} onClose={closeBuilding} onFocusCour={focusCour} />}
    {courFocused && <CourtyardCard onClose={() => setParams((current) => { const next = new URLSearchParams(current); next.delete('landmark'); next.delete('building'); next.delete('class'); return next; })} />}
    {optionsOpen && <AppDialog title="Options de la carte" onClose={() => setOptionsOpen(false)}>
      <div className="nav-map-options">
        <Link to="/map?view=list" aria-label="Afficher la liste des bâtiments" onClick={() => setOptionsOpen(false)}><List size={20} /><span>Liste des bâtiments</span><ChevronRight size={18} /></Link>
        <button type="button" onClick={() => { focusCour(); setOptionsOpen(false); }} aria-label="Centrer sur Cour Rouge"><span className="nav-cour-dot" /><span>Cour Rouge</span><ChevronRight size={18} /></button>
        <label><Layers2 size={20} /><span>Repères sur la carte</span><input className="nav-switch" type="checkbox" checked={labels} onChange={(event) => useAppStore.getState().setLabels(event.target.checked)} /></label>
        <div className="nav-map-options-north"><NorthControl /><span>Nord en haut</span></div>
        <details><summary><HelpCircle size={20} />Gestes et clavier<ChevronRight size={18} /></summary><dl><div><dt>Tourner</dt><dd>Glisser avec un doigt.</dd></div><div><dt>Déplacer / zoomer</dt><dd>Deux doigts, ou clic droit et molette.</dd></div><div><dt>Clavier</dt><dd>Flèches : déplacer · + / − : zoomer · Début : recentrer.</dd></div></dl></details>
      </div>
    </AppDialog>}
  </section>;
}
