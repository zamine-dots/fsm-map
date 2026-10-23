import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, Footprints, List, LoaderCircle, LocateFixed, MapPin, Minus, Navigation, Plus, Scan, Search, X } from 'lucide-react';
import DestinationSearch from '../components/navigation/DestinationSearch';
import DestinationArrival from '../components/navigation/DestinationArrival';
import WalkingMap from '../components/navigation/WalkingMap';
import { loadCampusGeometry } from '../lib/campus-geometry';
import { insidePolygon, type CampusModel, type Coordinate } from '../lib/campus';
import { campusData, findBuilding, floorsLabel, SIDE_LABEL } from '../lib/campus-catalog';
import { COUR_ROUGE, courRougePosition } from '../lib/campus-landmarks';
import { navigationDestinations, type NavigationDestination } from '../lib/navigation-destinations';
import { calculateWalkingRoute, createWalkNetwork, formatDistance, isNearCampus, routeInstructions } from '../lib/walking-route';
import { formatLocationAccuracy, locationPoint, useLiveLocation } from '../lib/useLiveLocation';
import { useAppStore, useMapStore } from '../store/useAppStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { useBuildingTags } from '../store/useBuildingTags';
import '../navigation.css';

const Map3D = lazy(() => import('../components/Map3D'));
type Step = 'destination' | 'origin' | 'map' | 'pick' | 'details';
const turnIcons = { straight: ArrowUp, left: ArrowLeft, right: ArrowRight, uturn: ArrowDownUp, connection: Footprints, stairs: ArrowUp };
const routeErrors = { outside: 'Vous êtes hors du campus.', 'off-path': 'Choisissez un point sur une allée.', 'no-access': 'Aucun accès cartographié pour cette salle.', disconnected: 'Aucun chemin continu depuis ce point.' };
const courtyardPoint = () => courRougePosition([campusData.coordinates.origin.lng, campusData.coordinates.origin.lat]);

export default function NavigatePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const classes = useScheduleStore((state) => state.classes);
  const tags = useBuildingTags((state) => state.tags);
  const destinations = useMemo(() => navigationDestinations(classes, tags), [classes, tags]);
  const requestedId = params.get('destination');
  const fromCour = params.get('from') === 'cour-rouge';
  const rawDestination = destinations.find((entry) => entry.id === requestedId) ?? null;
  const [step, setStep] = useState<Step>(() => rawDestination ? fromCour ? 'map' : 'origin' : 'destination');
  const [mapOpened, setMapOpened] = useState(step === 'map');
  const [model, setModel] = useState<CampusModel | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState<{ point: Coordinate; label: string } | null>(() => fromCour ? { point: courtyardPoint(), label: COUR_ROUGE.name } : null);
  const [candidate, setCandidate] = useState<Coordinate | null>(null);
  const [gpsRequest, setGpsRequest] = useState(0);
  const awaitingGps = useRef(false);
  const pendingSelection = useRef<{ id: string; step: Step } | null>(null);
  const location = useLiveLocation();
  const mode = useAppStore((state) => state.mapMode);
  const title = useRef<HTMLHeadingElement>(null);
  const network = useMemo(() => model ? createWalkNetwork(model) : null, [model]);
  const destination = useMemo(() => {
    if (!rawDestination || !model || rawDestination.entranceId) return rawDestination;
    const building = findBuilding(rawDestination.buildingId);
    const linkedTags = tags.filter((tag) => tag.courseId === rawDestination.courseId && !!rawDestination.courseId && tag.buildingId === rawDestination.buildingId);
    const tag = rawDestination.tag ?? (linkedTags.length === 1 ? linkedTags[0] : undefined);
    const rooms = tag ? model.campusBuildings.find((entry) => entry.id === rawDestination.buildingId)?.rooms.filter((room) => room.polygons.some((polygon) => insidePolygon(tag.point, polygon))) ?? [] : [];
    const room = rooms.length === 1 ? building?.rooms.find((entry) => entry.id === rooms[0].id) : undefined;
    return { ...rawDestination, tag, roomId: room?.id ?? rawDestination.roomId, entranceId: room?.entranceId, side: room?.side ?? rawDestination.side };
  }, [rawDestination, model, tags]);
  const building = findBuilding(destination?.buildingId);
  const gpsPoint = useMemo(() => location.fix ? locationPoint(location.fix) : null, [location.fix]);
  const origin = step === 'pick' ? candidate : manual?.point ?? (location.usable ? gpsPoint : null);
  const result = useMemo(() => network && origin && destination && building ? calculateWalkingRoute(network, origin, destination, building) : null, [network, origin, destination, building]);
  const route = result?.status === 'ready' ? result.route : null;
  const instructions = useMemo(() => route ? routeInstructions(route) : [], [route]);
  const arrived = !!route && !manual && location.usable && !!location.fix && location.fix.accuracy <= 20 && route.distance <= 12;
  const outside = !!(network && gpsPoint && location.usable && !isNearCampus(network, gpsPoint));
  const issue = !manual && location.issue ? location.issue : result && result.status !== 'ready' ? routeErrors[result.status] : null;
  const showMap = step === 'map' || step === 'pick';
  const live = !manual && location.usable;
  const displayedPosition = step === 'pick' ? candidate : origin && network && isNearCampus(network, origin) ? origin : null;
  const destinationDetail = [destination?.roomName !== destination?.title ? destination?.roomName : null, destination?.floors.length ? floorsLabel(destination.floors) : null, destination?.side ? SIDE_LABEL[destination.side] : building?.shortCode].filter(Boolean).join(' · ');
  const pickMessage = !candidate ? 'Touchez votre position sur la carte' : route ? `${route.minutes} min · ${formatDistance(route.distance)} vers ${destination?.title}` : issue ?? 'Calcul du trajet…';
  const gpsPendingLabel = location.refining ? 'Affinement du GPS…' : 'Localisation…';
  const gpsApproximation = location.refining && location.fix ? `Position approximative · ±${formatLocationAccuracy(location.fix.accuracy)}` : null;

  useEffect(() => {
    let active = true;
    setLoadError(false);
    loadCampusGeometry().then((loaded) => { if (active) setModel(loaded); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    if (showMap) setMapOpened(true);
    else if (step !== 'destination') title.current?.focus({ preventScroll: true });
  }, [step, showMap]);
  useEffect(() => {
    useMapStore.getState().selectBuilding(destination?.buildingId ?? null);
  }, [destination?.buildingId]);
  useEffect(() => {
    if (!rawDestination) setStep('destination');
    else if (pendingSelection.current?.id === rawDestination.id) {
      setStep(pendingSelection.current.step);
      pendingSelection.current = null;
    }
  }, [rawDestination]);
  useEffect(() => {
    if (fromCour) setManual({ point: courtyardPoint(), label: COUR_ROUGE.name });
    else setManual((current) => current?.label === COUR_ROUGE.name ? null : current);
  }, [fromCour]);
  useEffect(() => {
    if (awaitingGps.current && location.usable && network && gpsPoint && !outside) {
      awaitingGps.current = false;
      setStep('map');
    }
  }, [location.usable, network, gpsPoint, outside]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (step === 'pick') setStep('origin');
      if (step === 'details') setStep('map');
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [step]);

  const originLink = (courtyard: boolean) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (courtyard) next.set('from', 'cour-rouge'); else next.delete('from');
    return next;
  }, { replace: true });
  const selectDestination = (selected: NavigationDestination | null) => {
    const nextStep: Step = manual || (location.usable && !outside) ? 'map' : 'origin';
    pendingSelection.current = selected ? { id: selected.id, step: nextStep } : null;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('q');
      if (selected) next.set('destination', selected.id); else next.delete('destination');
      return next;
    });
    if (selected?.id === requestedId) {
      pendingSelection.current = null;
      setStep(nextStep);
    }
  };
  const useGps = () => {
    awaitingGps.current = true;
    originLink(false); setManual(null); setGpsRequest((current) => current + 1); location.start();
  };
  const chooseOrigin = (point: Coordinate, label: string) => {
    awaitingGps.current = false;
    location.stop(); originLink(label === COUR_ROUGE.name); setManual({ point, label }); setStep(destination ? 'map' : 'destination');
  };
  const pickOrigin = () => { awaitingGps.current = false; setCandidate(manual?.point ?? (location.usable && gpsPoint && !outside ? gpsPoint : null)); location.stop(); setStep('pick'); };
  const editOrigin = () => { awaitingGps.current = false; setStep('origin'); };
  const finish = () => { awaitingGps.current = false; location.stop(); navigate('/map'); };
  const onPick = useCallback((point: Coordinate) => setCandidate(point), []);
  const nextInstruction = instructions[0];
  const Turn = arrived ? Check : nextInstruction ? turnIcons[nextInstruction.kind] : Navigation;

  return <section className="journey" data-step={step} aria-label="Itinéraire vers votre salle">
    {mapOpened && <div className="journey-map-layer" style={{ visibility: showMap ? 'visible' : 'hidden' }} aria-hidden={!showMap}>
      {network ? <Suspense fallback={<div className="journey-loading" role="status"><LoaderCircle className="route-spinner" />Ouverture de la carte…</div>}>
        <Map3D onFocusCour={() => {}} navigation={{ route, position: displayedPosition, accuracy: live ? location.fix?.accuracy ?? null : null, live, picking: step === 'pick', destinationId: destination?.buildingId ?? null, fitKey: `${destination?.id}:${manual ? manual.point.join(',') : gpsRequest}`, onPick }}
          fallback={<div className="journey-fallback" data-testid="map-2d-fallback"><WalkingMap network={network} route={route} position={displayedPosition} accuracy={live ? location.fix?.accuracy ?? null : null} live={live} selectedBuildingId={destination?.buildingId ?? null} picking={step === 'pick'} onPick={onPick} onCancelPick={editOrigin} onSelect={() => {}} /></div>} />
      </Suspense> : <div className="journey-loading" role={loadError ? 'alert' : 'status'}><LoaderCircle className={loadError ? '' : 'route-spinner'} /><strong>{loadError ? 'Carte indisponible' : 'Chargement de la carte…'}</strong>{loadError && <button className="journey-primary" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>}</div>}
    </div>}

    {!showMap && <div className="journey-screen">
      <header className="journey-step-header"><button className="journey-icon-button" type="button" aria-label={step === 'details' ? 'Revenir au trajet' : 'Retour'} onClick={() => { awaitingGps.current = false; if (step === 'details') setStep('map'); else if (step === 'origin') setStep('destination'); else if (route) setStep('map'); else finish(); }}><ArrowLeft size={22} /></button><Link to="/map" className="journey-brand">FSM<span>Navigator</span></Link><button className="journey-icon-button" type="button" aria-label="Fermer l’itinéraire" onClick={finish}><X size={21} /></button></header>
      <div className="journey-step-body">
        <div className="journey-step-heading"><span className="journey-step-number">{step === 'details' ? 'VOTRE TRAJET' : step === 'destination' ? '01 / 02' : '02 / 02'}</span><h1 tabIndex={-1} ref={title}>{step === 'destination' ? 'Où allez-vous ?' : step === 'origin' ? 'Votre départ' : 'Étapes du trajet'}</h1></div>
        {step === 'destination' && <>
          {requestedId && !destination && <p className="journey-notice" role="status">Salle introuvable. Choisissez une destination.</p>}
          <DestinationSearch destinations={destinations} selected={destination} initialQuery={params.get('q') ?? ''} onSelect={selectDestination} />
        </>}
        {step === 'origin' && <>
          <button className="journey-destination-chip" type="button" onClick={() => setStep('destination')} aria-label="Changer de destination"><MapPin size={18} /><span>{destination?.title}</span><Search size={16} /></button>
          <div className="journey-origin-options">
            <button className="journey-location-option is-primary" type="button" onClick={useGps} disabled={location.pending}>{location.pending ? <LoaderCircle size={25} className="route-spinner" /> : <LocateFixed size={25} />}<span><strong>{location.pending ? gpsPendingLabel : 'Utiliser ma position'}</strong><small>{gpsApproximation ?? 'GPS'}</small></span><ArrowRight size={20} /></button>
            <button className="journey-location-option" type="button" onClick={pickOrigin}><MapPin size={24} /><span><strong>Placer sur la carte</strong><small>Choisir mon point de départ</small></span><ChevronRight size={20} /></button>
          </div>
          {(location.issue || outside) && <p className="journey-notice" role="status">{outside ? 'Vous êtes hors du campus. Choisissez un point sur la carte.' : location.issue}</p>}
          {location.refining && <p className="journey-notice" role="status">Autorisez la position précise dans les réglages du téléphone.</p>}
          <span className="journey-section-label">OU DEPUIS UN REPÈRE</span>
          <button className="journey-location-option is-landmark" type="button" onClick={() => chooseOrigin(courtyardPoint(), COUR_ROUGE.name)}><span className="journey-cour-swatch" /><span><strong>Cour Rouge</strong><small>Cour extérieure</small></span><ChevronRight size={20} /></button>
        </>}
        {step === 'details' && destination && building && <div className="journey-details">
          <div className="journey-detail-summary"><Footprints size={22} /><strong>{route ? `${route.minutes} min · ${formatDistance(route.distance)}` : destination.title}</strong></div>
          <ol aria-label="Étapes à pied">{instructions.map((instruction, index) => { const Icon = turnIcons[instruction.kind]; return <li key={index}><Icon size={22} /><span>{instruction.text}<small>{formatDistance(instruction.distance)}</small></span></li>; })}<li><MapPin size={22} /><span>{route?.nearby ? 'Près du bâtiment' : 'Entrée du bâtiment'}<small>{destination.title}</small></span></li></ol>
          {model && <DestinationArrival destination={destination} building={building} model={model} route={route} />}
          <p className="journey-source-note">Trajet extérieur suggéré · accès à vérifier sur place.</p>
        </div>}
      </div>
      <footer className="journey-step-footer">{step === 'destination' ? <Link to="/schedule">Mon planning<ChevronRight size={16} /></Link> : step === 'details' ? <button className="journey-primary" onClick={() => setStep('map')}><Navigation size={18} />Revenir à la carte</button> : <span><LocateFixed size={14} />Position utilisée uniquement pendant le trajet</span>}</footer>
    </div>}

    {showMap && <>
      <div className="journey-map-header"><button type="button" className="journey-map-title" onClick={() => step === 'pick' ? editOrigin() : setStep('destination')}><ArrowLeft size={21} /><span>{step === 'pick' ? 'Placez votre départ' : destination?.title ?? 'Itinéraire'}<small>{step === 'pick' ? 'Touchez une allée' : 'Modifier le trajet'}</small></span></button><button type="button" className="journey-icon-button" aria-label="Fermer l’itinéraire" onClick={finish}><X size={21} /></button></div>
      {step === 'map' && route && <div className="journey-next-turn" role="status"><Turn size={28} /><span><strong>{arrived ? 'Vous êtes arrivé' : nextInstruction?.text ?? 'Rejoignez l’entrée'}</strong><small>{arrived ? route.nearby ? 'Près du bâtiment' : 'À l’entrée du bâtiment' : nextInstruction ? formatDistance(nextInstruction.distance) : destination?.title}</small></span></div>}
      <div className="journey-map-tools" role="group" aria-label="Commandes de la carte">
        <button type="button" className="journey-icon-button" aria-label="Centrer sur ma position" onClick={() => { if (displayedPosition) useMapStore.getState().moveCamera('position'); else useGps(); }}><LocateFixed size={21} /></button>
        {step !== 'pick' && <button type="button" className="journey-icon-button journey-mode" aria-label={mode === '3d' ? 'Afficher en 2D' : 'Afficher en 3D'} onClick={() => useAppStore.getState().setMapMode(mode === '3d' ? '2d' : '3d')}>{mode === '3d' ? '2D' : '3D'}</button>}
        <button type="button" className="journey-icon-button" aria-label={step === 'pick' ? 'Voir tout le campus' : 'Voir tout le trajet'} onClick={() => useMapStore.getState().moveCamera(step === 'pick' || !route ? 'reset' : 'route')}><Scan size={20} /></button>
        <button type="button" className="journey-icon-button journey-zoom" aria-label="Zoom avant" onClick={() => useMapStore.getState().moveCamera('zoom-in')}><Plus size={21} /></button>
        <button type="button" className="journey-icon-button journey-zoom" aria-label="Zoom arrière" onClick={() => useMapStore.getState().moveCamera('zoom-out')}><Minus size={21} /></button>
      </div>
      {step === 'pick' ? <div className="journey-bottom-card journey-pick-card">
        <span data-testid="origin-preview" data-status={candidate ? result?.status ?? 'loading' : 'idle'} role="status">{route ? <Footprints size={20} /> : <MapPin size={20} />}<span>{pickMessage}</span></span>
        <button className="journey-primary" type="button" disabled={!candidate || !route} onClick={() => candidate && route && chooseOrigin(candidate, 'Point sur la carte')}>Confirmer ce point<ArrowRight size={18} /></button>
      </div> : <section className="journey-bottom-card" aria-label="Détails de l’itinéraire">
        <div className="journey-card-handle" />
        {route ? <>
          <div className="journey-summary" data-testid="route-summary" role="status"><span><strong>{arrived ? 'Arrivé' : `${route.minutes} min`}</strong><span>{formatDistance(route.distance)} à pied</span></span><span className={`journey-live-badge${live ? ' is-live' : ''}`}><i />{live ? 'GPS' : 'Aperçu'}</span></div>
          <div className="journey-arrival-line"><MapPin size={18} /><span><strong>{destination?.title}</strong><small>{destinationDetail}{route.nearby ? ' · près du bâtiment' : ''}</small></span></div>
          <div className="journey-card-actions"><button type="button" className="journey-secondary" onClick={() => setStep('details')}><List size={18} />Étapes</button><button type="button" className="journey-primary" onClick={live ? finish : useGps}>{live ? <Check size={18} /> : <LocateFixed size={18} />}{live ? 'Terminer' : 'Activer le GPS'}</button></div>
        </> : <div className="journey-route-status" role="status">{location.pending ? <><LoaderCircle className="route-spinner" size={22} /><strong>{gpsPendingLabel}</strong>{gpsApproximation && <small>{gpsApproximation}</small>}{location.refining && <small>Autorisez la position précise dans les réglages du téléphone.</small>}</> : issue ? <><MapPin size={22} /><strong>{issue}</strong></> : <><Navigation size={22} /><strong>{loadError ? 'Carte indisponible' : 'Préparation du trajet…'}</strong></>}<div className="journey-card-actions"><button type="button" className="journey-secondary" onClick={manual ? editOrigin : pickOrigin}>{manual ? 'Changer le départ' : 'Placer sur la carte'}</button>{!manual && !location.pending && <button type="button" className="journey-primary" onClick={useGps}>Réessayer le GPS</button>}</div></div>}
        {route && <button type="button" className="journey-origin-link" onClick={editOrigin}>Départ : {manual?.label ?? 'Ma position'}<ChevronRight size={13} /></button>}
      </section>}
      <a className="journey-attribution" href={campusData.source.url} target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </>}
  </section>;
}
