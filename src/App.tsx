import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Atom, BookOpen, Box, Building2,
  Check, ChevronDown, Code2, Compass, Download, Expand, FlaskConical,
  GraduationCap, HelpCircle, Info, Landmark, Layers3, LoaderCircle,
  LocateFixed, Map as MapIcon, MapPin, Menu, Minus, MousePointer2,
  Move, PanelLeftClose, Pause, Play, Plus, RotateCcw, Search, Share2,
  Sigma, SlidersHorizontal, Users, X,
} from 'lucide-react';
import CampusMap from './components/CampusMap';
import BuildingPanel from './components/BuildingPanel';
import Modal from './components/Modal';
import {
  CATEGORY_META, DEFAULT_LAYERS, downloadFile, exportGeoJSON, normalise,
  prepareCampus, readEdits, saveEdits, type BuildingEdits, type CampusBuilding,
  type CampusData, type CategoryFilter, type MapLayers,
} from './lib/campus';
import type { CampusViewer } from './lib/viewer';
import { CAN_EDIT_CAMPUS } from './lib/campus-editing';
import './styles.css';

function PlaceIcon({ building, size = 19 }: { building: CampusBuilding; size?: number }) {
  const name = normalise(building.name);
  if (name.includes('amphi')) return <GraduationCap size={size} />;
  if (name.includes('math')) return <Sigma size={size} />;
  if (name.includes('physique')) return <Atom size={size} />;
  if (name.includes('chimie')) return <FlaskConical size={size} />;
  if (name.includes('informatique')) return <Code2 size={size} />;
  if (name.includes('club')) return <Users size={size} />;
  if (building.category === 'service') return <Landmark size={size} />;
  if (building.category === 'life') return <BookOpen size={size} />;
  return <Building2 size={size} />;
}

export default function App() {
  const [data, setData] = useState<CampusData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(`${import.meta.env.BASE_URL}data/campus.geojson`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Campus data unavailable'); return response.json(); })
      .then((result: CampusData) => {
        if (result.type !== 'FeatureCollection' || !Array.isArray(result.features) || !result.metadata?.origin || !result.features.some((feature) => feature.properties.kind === 'boundary')) throw new Error('Invalid campus data');
        setData(result);
      })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  if (!data) return <main className="loading-page">
    <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="58" height="58" alt="" />
    <h1>{error ? 'Le campus est momentanément indisponible.' : 'Un nouveau point de vue sur la FSM.'}</h1>
    <p>{error ? 'Les données du plan n’ont pas pu être chargées.' : 'Préparation de votre visite…'}</p>
    {error ? <button className="primary-button" onClick={() => setAttempt((current) => current + 1)}><RotateCcw size={17} />Réessayer</button> : <LoaderCircle className="spinning" size={25} />}
  </main>;

  return <Explorer data={data} />;
}

function Explorer({ data }: { data: CampusData }) {
  const [edits, setEdits] = useState<BuildingEdits>(() => CAN_EDIT_CAMPUS ? readEdits() : {});
  const model = useMemo(() => prepareCampus(data, edits), [data, edits]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const requested = new URLSearchParams(window.location.search).get('building');
    return model.campusBuildings.some((building) => building.id === requested) ? requested : null;
  });
  const [indoor, setIndoor] = useState(false);
  const [floor, setFloor] = useState(0);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ ...DEFAULT_LAYERS });
  const [mode, setMode] = useState<'2d' | '3d'>('3d');
  const [orbit, setOrbit] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [layersOpen, setLayersOpen] = useState(false);
  const [dialog, setDialog] = useState<'about' | 'help' | 'export' | 'edit' | null>(null);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [view, setView] = useState({ heading: -40, scalePixels: 90 });
  const viewerRef = useRef<CampusViewer | null>(null);
  const mapContainer = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const lastViewUpdate = useRef(0);
  const initialFocus = useRef(false);
  const selected = model.campusBuildings.find((building) => building.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const search = normalise(query);
    return model.campusBuildings.filter((building) => (filter === 'all' || building.category === filter) && (!search || normalise([building.name, building.shortName, `Bâtiment ${building.number}`, CATEGORY_META[building.category].label, ...(building.correction?.aliases ?? []), ...building.rooms.map((room) => room.name)].join(' ')).includes(search)));
  }, [model, query, filter]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName) && !dialog) {
        event.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => searchInput.current?.focus(), 50);
      }
      if (event.key === 'Escape') setLayersOpen(false);
    };
    const handleFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('keydown', handleKey);
    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('fullscreenchange', handleFullscreen); };
  }, [dialog]);

  useEffect(() => {
    if (initialFocus.current) return;
    initialFocus.current = true;
    if (selectedId) viewerRef.current?.focusBuilding(selectedId);
  }, [selectedId]);

  const selectBuilding = useCallback((id: string | null) => {
    setSelectedId(id);
    setIndoor(false);
    setSelectedRoom(null);
    setOrbit(false);
    setLayersOpen(false);
    if (id) {
      setLayers((current) => current.buildings ? current : { ...current, buildings: true });
      viewerRef.current?.focusBuilding(id);
      if (window.innerWidth < 900) setSidebarOpen(false);
    }
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('building', id);
    else url.searchParams.delete('building');
    window.history.replaceState({}, '', url);
  }, []);

  const onView = useCallback((heading: number, scalePixels: number) => {
    const now = performance.now();
    if (now - lastViewUpdate.current < 100) return;
    lastViewUpdate.current = now;
    setView({ heading, scalePixels });
  }, []);

  const selectRoom = useCallback((id: string) => {
    const building = model.campusBuildings.find((candidate) => candidate.rooms.some((room) => room.id === id));
    const room = building?.rooms.find((candidate) => candidate.id === id);
    if (!building || !room) return;
    if (building.id !== selectedId) selectBuilding(building.id);
    else if (!indoor) viewerRef.current?.focusBuilding(building.id);
    setIndoor(true);
    setFloor((current) => building.id === selectedId && room.levels.includes(current) ? current : room.level);
    setSelectedRoom(id);
    setOrbit(false);
    setLayers((current) => ({ ...current, buildings: true, labels: true }));
  }, [model, selectedId, indoor, selectBuilding]);

  const onFallback = useCallback(() => { setFallback(true); setMode('2d'); setOrbit(false); }, []);
  const scaleMetres = view.scalePixels > 220 ? 10 : view.scalePixels > 140 ? 20 : 50;

  const toggleLayer = (key: keyof MapLayers) => setLayers((current) => ({ ...current, [key]: !current[key] }));

  const resetView = () => {
    selectBuilding(null);
    setOrbit(false);
    viewerRef.current?.reset();
  };

  const changeMode = (next: '2d' | '3d') => { setMode(next); setOrbit(false); };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await mapContainer.current?.requestFullscreen();
    } catch { setToast('Le plein écran n’est pas disponible dans ce navigateur.'); }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast('Lien copié. Il ouvre directement le lieu sélectionné.');
    } catch { setToast('Pour partager cette vue, copiez l’adresse de la page.'); }
  };

  const showIndoor = (enabled: boolean) => {
    setIndoor(enabled);
    setSelectedRoom(null);
    setOrbit(false);
    if (enabled && selected) {
      setFloor(Math.min(...selected.rooms.map((room) => room.level)));
      setLayers((current) => ({ ...current, buildings: true, labels: true }));
      viewerRef.current?.focusBuilding(selected.id);
    }
  };

  const saveBuilding = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!CAN_EDIT_CAMPUS || !selected) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const levels = Number(form.get('levels'));
    if (!name || name.length > 100 || !Number.isInteger(levels) || levels < 1 || levels > 12) return;
    const next = { ...edits, [selected.id]: { name, levels } };
    setEdits(next);
    const saved = saveEdits(next);
    setDialog(null);
    setToast(saved ? 'Correction enregistrée dans ce navigateur.' : 'Correction appliquée pour cette session. Le stockage local est indisponible.');
  };

  const restoreBuilding = () => {
    if (!CAN_EDIT_CAMPUS || !selected) return;
    const next = { ...edits };
    delete next[selected.id];
    setEdits(next);
    const saved = saveEdits(next);
    setDialog(null);
    setToast(saved ? 'Les données OpenStreetMap ont été rétablies.' : 'Données rétablies pour cette session ; stockage local indisponible.');
  };

  const exportMap = async (format: 'glb' | 'geojson') => {
    setExporting(true);
    try {
      if (format === 'glb') {
        if (!viewerRef.current) throw new Error('3D unavailable');
        const binary = await viewerRef.current.exportGLB();
        downloadFile(binary, 'fsm-campus.glb', 'model/gltf-binary');
      } else exportGeoJSON(data, edits);
      setDialog(null);
      setToast(format === 'glb' ? 'Modèle 3D téléchargé.' : 'Données du campus téléchargées.');
    } catch { setToast('L’export n’a pas abouti. Réessayez ou choisissez le format GeoJSON.'); }
    finally { setExporting(false); }
  };

  const layerOptions: { key: keyof MapLayers; label: string; description: string }[] = [
    { key: 'buildings', label: 'Bâtiments', description: 'Volumes du campus' },
    { key: 'greenery', label: 'Jardins & arbres', description: 'Espaces verts' },
    { key: 'paths', label: 'Allées piétonnes', description: 'Cheminements cartographiés' },
    { key: 'labels', label: 'Noms des lieux', description: 'Repères sur le plan' },
    { key: 'details', label: 'Détails architecturaux', description: 'Fenêtres & toitures illustratives' },
    { key: 'boundary', label: 'Limite du campus', description: 'Périmètre OpenStreetMap' },
  ];

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      <a className="skip-link" href="#campus-search">Aller à la recherche des bâtiments</a>
      <header className="app-header">
        <button className="icon-button mobile-menu" aria-label="Afficher la liste des bâtiments" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((current) => !current)}><Menu size={21} /></button>
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="FSM Explore, accueil"><img src={`${import.meta.env.BASE_URL}favicon.svg`} width="39" height="39" alt="" /><span>fsm<span className="brand-dot">.</span>explore<small>FACULTÉ DES SCIENCES DE MONASTIR</small></span></a>
        <nav className="header-nav" aria-label="Navigation principale"><button className="active" onClick={resetView}><MapIcon size={16} />Le campus</button><button onClick={() => setDialog('about')}>Le projet<ArrowUpRight size={14} /></button></nav>
        <div className="header-actions"><a className="icon-button" href="/map" title="Revenir à FSM Navigator" aria-label="Revenir à FSM Navigator"><Compass size={19} /></a><span className="beta-badge">VERSION BÊTA</span><button className="icon-button share-button" title="Copier le lien de cette vue" aria-label="Partager le campus" onClick={share}><Share2 size={18} /></button><button className="primary-button export-button" aria-label="Exporter le campus" onClick={() => setDialog('export')}><Download size={16} /><span>Exporter</span><ChevronDown size={14} /></button></div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Explorer les lieux du campus">
        <div className="sidebar-intro">
          <div className="eyebrow"><span className="status-dot" />LE CAMPUS, AUTREMENT<button className="icon-button small sidebar-close" aria-label="Masquer la liste des bâtiments" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
          <h1>Prenez un peu<br />de hauteur<span>.</span></h1>
          <p>Un nouveau point de vue sur la Faculté des Sciences de Monastir.</p>
          <div className="campus-stats"><span><Building2 size={15} /><strong>{model.campusBuildings.length}</strong> bâtiments</span><span><DoorIcon /><strong>{model.rooms.length}</strong> salles repérées</span></div>
        </div>
        <div className="search-area">
          <label className="search-box" htmlFor="campus-search"><Search size={18} /><input ref={searchInput} id="campus-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Un département, une salle…" autoComplete="off" />{query ? <button aria-label="Effacer la recherche" onClick={() => setQuery('')}><X size={15} /></button> : <kbd>/</kbd>}</label>
          <div className="filter-chips" aria-label="Filtrer les lieux">
            {([['all', 'Tout'], ['department', 'Départements'], ['teaching', 'Enseignement'], ['service', 'Services'], ['life', 'Vie du campus']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
        </div>
        <div className="results-heading"><span>{query ? 'RÉSULTATS DE RECHERCHE' : 'LES LIEUX DU CAMPUS'}</span><span className="result-count" aria-live="polite">{filtered.length}</span></div>
        <div className="places-list">
          {filtered.map((building) => <button className={`place-card ${selectedId === building.id ? 'active' : ''}`} key={building.id} onClick={() => selectBuilding(building.id)} aria-pressed={selectedId === building.id}>
            <span className={`place-icon ${building.category}`}><PlaceIcon building={building} /></span>
            <span className="place-copy"><strong>{building.shortName}</strong><span>{building.category === 'department' ? 'Département' : building.named ? CATEGORY_META[building.category].label : 'Nom à confirmer'}{building.rooms.length > 0 && <span className="room-count"> · {building.rooms.length} salles</span>}</span></span>
            <ArrowUpRight className="place-arrow" size={16} />
          </button>)}
          {!filtered.length && <div className="empty-search"><Search size={29} /><strong>Aucun lieu trouvé</strong><p>Essayez « Physique », « LC » ou un numéro de salle.</p><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>Réinitialiser la recherche<ArrowRight size={15} /></button></div>}
        </div>
        <div className="sidebar-footer"><div className="explore-tip"><span className="tip-icon"><MousePointer2 size={20} /></span><div><strong>À vous d’explorer.</strong><p>Sélectionnez un bâtiment<br />pour en découvrir les détails.</p></div></div><button className="source-link" onClick={() => setDialog('about')}><Info size={13} />Un plan ouvert, à enrichir ensemble<ArrowUpRight size={13} /></button></div>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fermer la liste" onClick={() => setSidebarOpen(false)} />}

      <main className="map-workspace" ref={mapContainer} aria-label="Carte interactive du campus">
        <CampusMap model={model} viewerRef={viewerRef} selectedId={selectedId} selectedRoom={selectedRoom} indoor={indoor} floor={floor} layers={layers} filter={filter} mode={mode} orbit={orbit} onSelect={selectBuilding} onSelectRoom={selectRoom} onView={onView} onFallback={onFallback} />
        <div className="map-topbar">
          <div className="map-location">{!sidebarOpen && <button className="icon-button reopen-sidebar" title="Explorer les bâtiments" aria-label="Afficher la liste des bâtiments" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>}<div><span><MapPin size={13} />MONASTIR, TUNISIE</span><strong>Le savoir prend place.</strong></div></div>
          <div className="view-tools"><div className="view-toggle" aria-label="Mode d’affichage"><button className={mode === '3d' ? 'active' : ''} aria-pressed={mode === '3d'} disabled={fallback} onClick={() => changeMode('3d')}><Box size={16} />3D</button><button className={mode === '2d' ? 'active' : ''} aria-pressed={mode === '2d'} onClick={() => changeMode('2d')}><MapIcon size={16} />2D</button></div><button className={`layer-button ${layersOpen ? 'active' : ''}`} aria-label="Afficher les couches de la carte" aria-expanded={layersOpen} onClick={() => setLayersOpen((current) => !current)}><SlidersHorizontal size={17} /><span>Couches</span></button></div>
        </div>

        {layersOpen && <div className="layers-panel"><div className="popover-heading"><strong>Composer votre vue</strong><button className="icon-button small" aria-label="Fermer les couches" onClick={() => setLayersOpen(false)}><X size={17} /></button></div>{layerOptions.map((option) => <label className="layer-option" key={option.key}><span><strong>{option.label}</strong><small>{option.description}</small></span><input type="checkbox" checked={layers[option.key]} onChange={() => toggleLayer(option.key)} /><span className="toggle-switch" aria-hidden="true" /></label>)}<button className="text-button layer-reset" onClick={() => setLayers({ ...DEFAULT_LAYERS })}><RotateCcw size={13} />Tout réafficher</button></div>}

        {selected && !layersOpen && <BuildingPanel key={selected.id} building={selected} origin={model.data.metadata.origin} indoor={indoor} floor={floor} selectedRoom={selectedRoom} onClose={() => selectBuilding(null)} onEdit={() => setDialog('edit')} onIndoor={showIndoor} onFloor={(level) => { setFloor(level); setSelectedRoom(null); }} onRoom={selectRoom} onFocus={() => { setOrbit(false); viewerRef.current?.focusBuilding(selected.id); }} onFocusCour={fallback ? undefined : () => { selectBuilding(null); setLayers((current) => ({ ...current, labels: true })); viewerRef.current?.focusCourRouge(); }} />}

        <div className="map-legend"><span className="legend-title">SUR LE PLAN</span><span><i className="legend-building" />Bâtiments</span><span><i className="legend-garden" />Jardins</span><span><i className="legend-path" />Allées</span></div>
        <div className="map-controls"><button className="compass-button" aria-label="Orienter la carte vers le nord" title="Nord en haut" disabled={fallback} onClick={() => viewerRef.current?.north()}><span>N</span><Compass size={31} strokeWidth={1.25} style={{ transform: `rotate(${view.heading + 45}deg)` }} /></button><div className="zoom-controls"><button aria-label="Zoomer" title="Zoomer (+)" disabled={fallback} onClick={() => viewerRef.current?.zoom(1)}><Plus size={20} /></button><button aria-label="Dézoomer" title="Dézoomer (−)" disabled={fallback} onClick={() => viewerRef.current?.zoom(-1)}><Minus size={20} /></button><span /><button aria-label="Recentrer le campus" title="Vue d’ensemble" onClick={resetView}><LocateFixed size={19} /></button>{document.fullscreenEnabled && <button aria-label={fullscreen ? 'Quitter le plein écran' : 'Afficher en plein écran'} title="Plein écran" onClick={toggleFullscreen}><Expand size={18} /></button>}</div></div>
        <div className="map-bottom-center"><div className="gesture-hint"><MousePointer2 size={14} /><span>{mode === '3d' ? 'Glissez pour tourner' : 'Glissez pour déplacer'}</span><i /><span>Défilez pour zoomer</span></div><button className={`orbit-button ${orbit ? 'active' : ''}`} disabled={mode === '2d' || fallback} aria-label={orbit ? 'Arrêter la rotation automatique' : 'Faire tourner le campus'} title={orbit ? 'Arrêter la rotation' : 'Visite à 360°'} aria-pressed={orbit} onClick={() => setOrbit((current) => !current)}>{orbit ? <Pause size={15} /> : <Play size={15} />}</button></div>
        <div className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a><span>·</span><button onClick={() => setDialog('about')}>Volumes estimés<Info size={11} /></button></div>
        <div className="map-bottom-right"><div className="map-scale"><span>{scaleMetres} m</span><i style={{ width: `${Math.max(24, view.scalePixels * scaleMetres / 50)}px` }} /></div><button className="icon-button help-button" aria-label="Aide pour utiliser la carte" onClick={() => setDialog('help')}><HelpCircle size={19} /></button></div>
        <div className="coordinate-stamp">35.7648° N &nbsp; 10.8054° E</div>
      </main>

      {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="Fermer la notification" onClick={() => setToast('')}><X size={15} /></button></div>}

      {dialog === 'about' && <Modal title="Un nouveau regard sur la FSM" onClose={() => setDialog(null)}><div className="modal-intro-icon"><GraduationCap size={30} /></div><p className="modal-lead">Un campus vivant. Un plan ouvert.</p><p>Explorez la Faculté des Sciences de Monastir à partir des bâtiments, jardins et cheminements cartographiés par la communauté OpenStreetMap.</p><div className="data-summary"><span><strong>{model.campusBuildings.length}</strong>Bâtiments FSM</span><span><strong>{model.rooms.length}</strong>Salles repérées</span><span><strong>{(model.area / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</strong>Hectares cartographiés</span></div><div className="accuracy-note"><Info size={19} /><div><strong>Ce que le plan vous montre</strong><p>Les emprises, noms et niveaux renseignés viennent d’OpenStreetMap. Sans hauteur mesurée, un niveau représente 3,5 m. Les niveaux manquants sont estimés. Les fenêtres, équipements de toiture et arbres sont illustratifs. Les plans intérieurs sont partiels ; ils ne constituent pas un relevé architectural.</p></div></div>{CAN_EDIT_CAMPUS && <p>Vos ajustements restent dans ce navigateur. Ils accompagnent l’export GeoJSON sans modifier OpenStreetMap.</p>}<div className="source-details"><span>Données téléchargées le {new Date(`${data.metadata.retrievedAt}T00:00:00`).toLocaleDateString('fr-FR')}</span><a href={data.metadata.source} target="_blank" rel="noreferrer">Voir le campus dans OpenStreetMap<ArrowUpRight size={15} /></a><a href={data.metadata.licenseUrl} target="_blank" rel="noreferrer">© OpenStreetMap contributors · Licence ODbL<ArrowUpRight size={15} /></a><small>Projet indépendant, sans affiliation officielle avec la faculté.</small></div></Modal>}

      {dialog === 'help' && <Modal title="Prenez le campus en main" onClose={() => setDialog(null)}><p>Changez de perspective, trouvez un lieu et explorez les salles disponibles.</p><div className="help-list"><div><MousePointer2 /><span><strong>Tourner autour du campus</strong>Maintenez le clic gauche et glissez en 3D. Sur écran tactile, glissez avec un doigt.</span></div><div><Move /><span><strong>Déplacer la carte</strong>Clic droit et glisser, ou deux doigts sur écran tactile. En 2D, utilisez le clic gauche.</span></div><div><Search /><span><strong>Zoomer et rechercher</strong>Utilisez la molette, pincez l’écran ou appuyez sur + / −. La touche / ouvre la recherche.</span></div><div><Building2 /><span><strong>Découvrir un bâtiment</strong>Cliquez sur son volume, son étiquette ou son nom dans la liste. « Explorer les salles » ouvre les plans disponibles.</span></div><div><Compass /><span><strong>Se repérer au clavier</strong>Quand la carte est sélectionnée, utilisez les flèches pour vous déplacer, Origine pour recentrer et Échap pour fermer la sélection.</span></div></div><button className="primary-button modal-main-button" onClick={() => setDialog(null)}>C’est parti<ArrowRight size={17} /></button></Modal>}

      {dialog === 'export' && <Modal title="Emportez le campus avec vous" onClose={() => !exporting && setDialog(null)}><p>Le modèle reste à l’échelle, en mètres. Les exports incluent la source des données{CAN_EDIT_CAMPUS && ' et vos corrections locales'}.</p><button className="export-option" disabled={exporting || fallback} onClick={() => exportMap('glb')}><span className="export-format"><Box size={24} /></span><span><strong>Modèle 3D <em>.GLB</em></strong><small>Volumes, façades et jardins. Pour Blender, Unity ou un visualiseur 3D.</small></span>{exporting ? <LoaderCircle size={19} className="spinning" /> : <ArrowDownToLine size={20} />}</button><button className="export-option" disabled={exporting} onClick={() => exportMap('geojson')}><span className="export-format"><MapIcon size={24} /></span><span><strong>Données géographiques <em>.GEOJSON</em></strong><small>Coordonnées WGS84, attributs OSM et salles{CAN_EDIT_CAMPUS && ' · corrections locales séparées'}.</small></span><ArrowDownToLine size={20} /></button>{fallback && <p className="small-note">L’export 3D nécessite un navigateur avec WebGL.</p>}<p className="small-note">Données © OpenStreetMap contributors, licence ODbL. Les hauteurs et détails illustratifs ne sont pas des mesures de terrain.</p></Modal>}

      {CAN_EDIT_CAMPUS && dialog === 'edit' && selected && <Modal title="Ajuster ce bâtiment" onClose={() => setDialog(null)}><p>Vous connaissez ce lieu ? Précisez son nom et ses niveaux. Ces modifications sont enregistrées uniquement dans votre navigateur.</p><form className="edit-form" onSubmit={saveBuilding}><label>Nom du bâtiment<input name="name" defaultValue={selected.name} maxLength={100} required /></label><label>Nombre de niveaux, RDC inclus<input name="levels" type="number" min="1" max="12" step="1" defaultValue={selected.levels} required /></label><p className="small-note">Le volume sera recalculé à raison de 3,5 m par niveau. La hauteur reste une estimation.</p><button className="primary-button" type="submit"><Check size={17} />Enregistrer la correction</button>{selected.edited && <button className="text-button restore-button" type="button" onClick={restoreBuilding}><RotateCcw size={14} />Revenir aux données OpenStreetMap</button>}</form></Modal>}
    </div>
  );
}

function DoorIcon() {
  return <Layers3 size={15} />;
}
