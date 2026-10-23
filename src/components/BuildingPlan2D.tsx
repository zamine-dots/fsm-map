import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowUp, Download, MapPin, Pencil, Plus, RotateCcw, Save, Tag, Trash2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { boundsOf, type CampusBuilding, type CampusModel, type Coordinate } from '../lib/campus';
import { loadCampusGeometry } from '../lib/campus-geometry';
import { campusData, floorLabel } from '../lib/campus-catalog';
import { COUR_ROUGE, courRougeReference } from '../lib/campus-landmarks';
import { BUILDING_TAGS_KEY, interiorPoint, parseBuildingTagsBackup, pointInFootprint, polygonPath, serializeBuildingTags, type BuildingTag } from '../lib/building-tags';
import { createScheduleId, scheduleEditUrl, scheduleTitle } from '../lib/schedule';
import { downloadTextFile, SCHEDULE_STORAGE_KEY } from '../lib/storage';
import { useBuildingTags } from '../store/useBuildingTags';
import { useScheduleStore } from '../store/useScheduleStore';
import { CAN_EDIT_CAMPUS, LOCAL_ROOM_API } from '../lib/campus-editing';
import { publishedRoomData, publishedRoomTags, roomLocationsFromTags } from '../lib/published-room-locations';
import { navigationDestinations, navigationUrl } from '../lib/navigation-destinations';
import './building-plan.css';

interface Props {
  buildingId: string;
  building?: CampusBuilding;
  origin?: Coordinate;
  initialCourseId?: string;
  onFocusCour?: () => void;
}

export default function BuildingPlan2D(props: Props) {
  const [model, setModel] = useState<CampusModel | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (props.building) return;
    let active = true;
    setError(false);
    loadCampusGeometry().then((loaded) => { if (active) setModel(loaded); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [props.building, attempt]);
  const building = props.building ?? model?.campusBuildings.find((entry) => entry.id === props.buildingId);
  const origin = props.origin ?? model?.data.metadata.origin ?? [campusData.coordinates.origin.lng, campusData.coordinates.origin.lat];
  if (!building) return <section className="fsm-building-plan fsm-plan-loading" aria-label="Plan 2D du bâtiment">
    <p role="status">{error || model ? 'Le plan 2D n’a pas pu être chargé.' : 'Chargement du plan 2D…'}</p>
    {(error || model) && <button type="button" className="fsm-plan-button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={15} />Réessayer</button>}
  </section>;
  return <BuildingPlan key={`${building.id}:${props.initialCourseId ?? ''}`} building={building} origin={origin} initialCourseId={props.initialCourseId} onFocusCour={props.onFocusCour} />;
}

type Draft = Omit<BuildingTag, 'point'> & { point: Coordinate | null; original?: BuildingTag };

function BuildingPlan({ building, origin, initialCourseId, onFocusCour }: { building: CampusBuilding; origin: Coordinate; initialCourseId?: string; onFocusCour?: () => void }) {
  const localTags = useBuildingTags((state) => state.tags);
  const allTags = CAN_EDIT_CAMPUS ? localTags : publishedRoomTags;
  const destinations = useMemo(() => CAN_EDIT_CAMPUS ? [] : navigationDestinations([], [], allTags), [allTags]);
  const storageStatus = useBuildingTags((state) => state.status);
  const originalRaw = useBuildingTags((state) => state.originalRaw);
  const allCourses = useScheduleStore((state) => state.classes);
  const courses = allCourses.filter((course) => course.buildingId === building.id);
  const initialCourse = courses.find((course) => course.id === initialCourseId);
  const tags = allTags.filter((tag) => tag.buildingId === building.id);
  const [floor, setFloor] = useState<number | null>(initialCourse ? initialCourse.floor : 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<Coordinate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BuildingTag | null>(null);
  const [pendingImport, setPendingImport] = useState<BuildingTag[] | null>(null);
  const [replaceOriginal, setReplaceOriginal] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [projectRevision, setProjectRevision] = useState(publishedRoomData.updatedAt);
  const svg = useRef<SVGSVGElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const instructionsId = useId();
  const floorId = useId();
  const bounds = useMemo(() => boundsOf(building.polygons.flatMap((polygon) => polygon[0])), [building]);
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
  const padding = extent * 0.14;
  const unit = extent / 100;
  const viewBox = `${bounds.minX - padding} ${bounds.minZ - padding} ${bounds.maxX - bounds.minX + padding * 2} ${bounds.maxZ - bounds.minZ + padding * 2}`;
  const rooms = building.rooms.filter((room) => floor !== null && room.levels.includes(floor));
  const visibleTags = tags.filter((tag) => tag.floor === floor);
  const floors = [...new Set([
    ...Array.from({ length: Math.min(building.levels, 200) }, (_, index) => index),
    ...building.rooms.flatMap((room) => room.levels),
    ...tags.flatMap((tag) => tag.floor === null ? [] : [tag.floor]),
    ...courses.flatMap((course) => course.floor === null ? [] : [course.floor]),
  ])].sort((first, second) => first - second);
  const reference = courRougeReference(building.center, origin);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === BUILDING_TAGS_KEY || event.key === null) useBuildingTags.getState().reload();
      if (event.key === SCHEDULE_STORAGE_KEY || event.key === null) useScheduleStore.getState().reloadStorage();
    };
    useBuildingTags.getState().reload();
    useScheduleStore.getState().reloadStorage();
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  useEffect(() => { if (draft) labelInput.current?.focus({ preventScroll: true }); }, [draft?.id]);

  const clearFeedback = () => { setError(''); setMessage(''); };
  const report = (failure: unknown) => setError(failure instanceof Error ? failure.message : 'L’opération n’a pas abouti.');
  const startTag = () => {
    if (!CAN_EDIT_CAMPUS) return;
    clearFeedback();
    setPendingDelete(null);
    setDraft({ id: createScheduleId(), buildingId: building.id, label: initialCourse ? scheduleTitle(initialCourse).slice(0, 100) : '', floor, point: null, courseId: initialCourse?.id ?? null });
    setCursor(interiorPoint(building.polygons));
  };
  const editTag = (tag: BuildingTag) => {
    if (!CAN_EDIT_CAMPUS) return;
    clearFeedback();
    setFloor(tag.floor);
    setDraft({ ...tag, point: [...tag.point], original: tag });
    setCursor(tag.point);
    setPendingDelete(null);
  };
  const place = (point: Coordinate) => {
    if (!CAN_EDIT_CAMPUS || !draft) return;
    if (!pointInFootprint(point, building.polygons)) { setError('Placez le tag à l’intérieur du bâtiment, en dehors des cours ouvertes.'); return; }
    setError('');
    setCursor(point);
    setDraft({ ...draft, point });
    setMessage('Position choisie. Enregistrez le tag pour la conserver.');
  };
  const clickPlan = (event: MouseEvent<SVGSVGElement>) => {
    if (!CAN_EDIT_CAMPUS || !draft || event.button !== 0) return;
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    place([point.x, point.y]);
  };
  const moveCursor = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!CAN_EDIT_CAMPUS || !draft || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.key === 'Enter' || event.key === ' ') && cursor) { event.preventDefault(); place(cursor); return; }
    const delta: Record<string, Coordinate> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!delta[event.key]) return;
    event.preventDefault();
    const start = cursor ?? interiorPoint(building.polygons);
    if (!start) return;
    const step = extent / (event.shiftKey ? 200 : 40);
    setCursor([
      Math.max(bounds.minX, Math.min(bounds.maxX, start[0] + delta[event.key][0] * step)),
      Math.max(bounds.minZ, Math.min(bounds.maxZ, start[1] + delta[event.key][1] * step)),
    ]);
  };
  const saveTag = (event: FormEvent) => {
    event.preventDefault();
    if (!CAN_EDIT_CAMPUS) return;
    clearFeedback();
    try {
      if (!draft?.point || !pointInFootprint(draft.point, building.polygons)) throw new Error('Choisissez une position dans le bâtiment.');
      if (draft.courseId && !courses.some((course) => course.id === draft.courseId)) throw new Error('Ce cours n’est plus dans ce bâtiment. Choisissez un autre cours ou un tag libre.');
      const { original, ...tag } = draft;
      useBuildingTags.getState().saveTag({ ...tag, point: draft.point }, original);
      setDraft(null);
      setMessage(useBuildingTags.getState().status === 'ready' ? 'Tag enregistré dans ce navigateur.' : 'Tag conservé dans cet onglet. Exportez les tags pour les garder.');
    } catch (failure) { report(failure); }
  };
  const exportTags = (raw = false) => {
    if (!CAN_EDIT_CAMPUS) return;
    clearFeedback();
    try { downloadTextFile(raw && originalRaw !== null ? originalRaw : serializeBuildingTags(allTags), raw ? 'fsm-tags-copie-originale.txt' : 'fsm-tags-batiments.json', raw ? 'text/plain' : 'application/json'); }
    catch (failure) { report(failure); }
  };
  const saveProject = async () => {
    if (!CAN_EDIT_CAMPUS || savingProject || draft) return;
    clearFeedback(); setSavingProject(true);
    try {
      const response = await fetch(LOCAL_ROOM_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FSM-Local-Editor': '1' }, body: JSON.stringify(roomLocationsFromTags(allTags, projectRevision)) });
      const result = await response.json();
      if (!response.ok || result.saved !== true) throw new Error(result.error ?? 'Les salles n’ont pas pu être enregistrées dans le projet.');
      setProjectRevision(result.updatedAt);
      setMessage('Salles enregistrées dans le projet. Elles seront partagées au prochain déploiement.');
    } catch (failure) { report(failure); }
    finally { setSavingProject(false); }
  };

  return <section className="fsm-building-plan" data-editable={CAN_EDIT_CAMPUS} aria-labelledby={headingId} onKeyDown={(event) => {
    if (event.key === 'Escape' && (draft || pendingDelete || pendingImport || replaceOriginal)) {
      event.preventDefault(); event.stopPropagation(); setDraft(null); setPendingDelete(null); setPendingImport(null); setReplaceOriginal(false); clearFeedback();
    }
  }}>
    <header className="fsm-plan-heading"><h3 id={headingId}><Tag size={16} />{CAN_EDIT_CAMPUS ? 'Plan 2D & tags' : 'Plan des salles'}</h3><span>{tags.length} repère{tags.length > 1 ? 's' : ''}</span></header>
    <div className="fsm-plan-toolbar">
      <label htmlFor={floorId}>Niveau</label>
      <select id={floorId} value={floor === null ? 'unknown' : floor} onChange={(event) => {
        const next = event.target.value === 'unknown' ? null : Number(event.target.value);
        setFloor(next); if (draft) setDraft({ ...draft, floor: next }); clearFeedback();
      }}>
        {floors.map((value) => <option value={value} key={value}>{floorLabel(value)}</option>)}
        <option value="unknown">Niveau non précisé</option>
      </select>
      {CAN_EDIT_CAMPUS && !draft && <button type="button" className="fsm-plan-button fsm-plan-primary" onClick={startTag}><Plus size={15} />Ajouter un tag</button>}
    </div>

    <div className="fsm-plan-canvas" data-placing={Boolean(draft)}>
      <span className="fsm-plan-north" aria-label="Le nord est en haut"><ArrowUp size={16} />N</span>
      <svg ref={svg} viewBox={viewBox} role="group" tabIndex={0} aria-label={`Plan 2D de ${building.name}`} aria-describedby={instructionsId} onClick={clickPlan} onKeyDown={moveCursor}>
        {building.polygons.map((polygon, index) => <path key={index} d={polygonPath(polygon)} fill="var(--plan-building)" fillRule="evenodd" stroke="var(--plan-outline)" strokeWidth={unit * 0.6} />)}
        {rooms.flatMap((room) => room.polygons.map((polygon, index) => <path key={`${room.id}-${index}`} d={polygonPath(polygon)} fill="var(--plan-room)" fillRule="evenodd" stroke="var(--plan-surface)" strokeWidth={unit * 0.5}><title>{room.name}</title></path>))}
        {rooms.map((room) => <text key={room.id} x={room.center[0]} y={room.center[1]} className="fsm-plan-room-name" textAnchor="middle" fontSize={unit * 2.9} strokeWidth={unit * 0.8}>{room.name}</text>)}
        {visibleTags.map((tag, index) => {
          if (!pointInFootprint(tag.point, building.polygons) || tag.id === draft?.id) return null;
          const rightHalf = tag.point[0] > (bounds.minX + bounds.maxX) / 2;
          return <g key={tag.id} role={CAN_EDIT_CAMPUS ? 'button' : 'img'} tabIndex={CAN_EDIT_CAMPUS ? 0 : undefined} aria-label={CAN_EDIT_CAMPUS ? `Modifier le tag ${tag.label}` : tag.label} data-tag-id={tag.id} className="fsm-plan-pin" data-course-selected={tag.courseId === initialCourseId}
            onClick={CAN_EDIT_CAMPUS ? (event) => { event.stopPropagation(); editTag(tag); } : undefined} onKeyDown={CAN_EDIT_CAMPUS ? (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); editTag(tag); } } : undefined}>
            <title>{tag.label}</title>
            <circle cx={tag.point[0]} cy={tag.point[1]} r={unit * 5} fill="transparent" />
            <circle className="fsm-plan-pin-dot" cx={tag.point[0]} cy={tag.point[1]} r={unit * 2.8} strokeWidth={unit * 0.55} />
            <text x={tag.point[0]} y={tag.point[1] + unit * 1.1} textAnchor="middle" fill="#fff" fontSize={unit * 3.2} fontWeight="700">{index + 1}</text>
            <text className="fsm-plan-pin-name" x={tag.point[0] + unit * (rightHalf ? -4 : 4)} y={tag.point[1] - unit * 3.3} textAnchor={rightHalf ? 'end' : 'start'} fontSize={unit * 3} strokeWidth={unit}>{tag.label.length > 18 ? `${tag.label.slice(0, 17)}…` : tag.label}</text>
          </g>;
        })}
        {draft?.point && <g className="fsm-plan-draft" pointerEvents="none"><circle cx={draft.point[0]} cy={draft.point[1]} r={unit * 3} fill="#bb771d" stroke="#fff" strokeWidth={unit * 0.7} /><text x={draft.point[0]} y={draft.point[1] - unit * 4} textAnchor="middle" fontSize={unit * 3.2} className="fsm-plan-pin-name" strokeWidth={unit}>Position du tag</text></g>}
        {draft && cursor && <g pointerEvents="none" stroke={pointInFootprint(cursor, building.polygons) ? '#285e45' : '#c8373e'} strokeWidth={unit * 0.65} fill="none"><circle cx={cursor[0]} cy={cursor[1]} r={unit * 4.4} strokeDasharray={`${unit * 1.5} ${unit}`} /><path d={`M${cursor[0] - unit * 6},${cursor[1]}h${unit * 12} M${cursor[0]},${cursor[1] - unit * 6}v${unit * 12}`} /></g>}
      </svg>
    </div>
    <p className="fsm-plan-hint" id={instructionsId}>{CAN_EDIT_CAMPUS ? draft ? 'Touchez le plan pour placer le tag. Au clavier : flèches pour viser, Entrée pour poser. Maj + flèche pour affiner.' : 'Choisissez un niveau, puis ajoutez un tag à l’emplacement de votre salle ou de votre cours.' : 'Choisissez un niveau pour consulter les salles.'}</p>
    <p className="fsm-plan-hint">{rooms.length ? `${rooms.length} espaces cartographiés à ce niveau · plan intérieur partiel.` : visibleTags.length ? 'Emprise du bâtiment · repères des salles à ce niveau.' : 'Emprise du bâtiment · les salles de ce niveau ne sont pas cartographiées.'}</p>
    <div className="fsm-plan-reference">
      <span className="fsm-plan-reference-arrow" style={{ transform: `rotate(${reference.bearing}deg)` }}><ArrowUp size={20} /></span>
      <span><strong>{COUR_ROUGE.name}</strong><small>{COUR_ROUGE.typeLabel} · À environ {reference.distance} m {reference.direction} · à vol d’oiseau</small></span>
      {onFocusCour && <button type="button" className="fsm-plan-icon" onClick={onFocusCour} aria-label="Voir Cour Rouge sur la carte"><MapPin size={18} /></button>}
    </div>

    {CAN_EDIT_CAMPUS && draft && <form className="fsm-plan-editor" onSubmit={saveTag}>
      <div className="fsm-plan-editor-title"><h4>{draft.original ? 'Modifier le tag' : 'Nouveau tag'}</h4><button type="button" className="fsm-plan-icon" aria-label="Annuler l’édition du tag" onClick={() => { setDraft(null); clearFeedback(); }}><X size={17} /></button></div>
      <label className="fsm-plan-field">Cours associé<select value={draft.courseId ?? ''} onChange={(event) => {
        const course = courses.find((entry) => entry.id === event.target.value);
        setDraft({ ...draft, courseId: course?.id ?? null, label: course ? scheduleTitle(course).slice(0, 100) : draft.label, floor: course ? course.floor : floor });
        if (course) setFloor(course.floor);
      }}>
        <option value="">Tag libre / nom de salle</option>
        {draft.courseId && !courses.some((course) => course.id === draft.courseId) && <option value={draft.courseId}>Cours indisponible — choisir un autre lien</option>}
        {courses.map((course) => <option key={course.id} value={course.id}>{scheduleTitle(course)} · {course.room}</option>)}
      </select></label>
      <label className="fsm-plan-field">Nom du tag<input ref={labelInput} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} maxLength={100} required placeholder="Ex. Salle 12 · TP de physique" /></label>
      {rooms.length > 0 && <label className="fsm-plan-field">Placer dans une salle cartographiée<select value="" onChange={(event) => {
        const room = rooms.find((entry) => entry.id === event.target.value);
        const point = room ? interiorPoint(room.polygons) : null;
        if (point && pointInFootprint(point, building.polygons)) { setDraft({ ...draft, point, label: draft.label || room!.name }); setCursor(point); setError(''); }
      }}><option value="">Choisir une salle ou toucher le plan</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>}
      <p className="fsm-plan-hint">{floorLabel(draft.floor)} · {draft.point ? 'Position choisie' : 'Choisissez une position sur le plan'}</p>
      <div className="fsm-plan-actions"><button type="button" className="fsm-plan-button" onClick={() => { setDraft(null); clearFeedback(); }}>Annuler</button><button type="submit" className="fsm-plan-button fsm-plan-primary" disabled={!draft.point}>Enregistrer le tag</button></div>
    </form>}

    {visibleTags.length > 0 && <ol className="fsm-plan-tags" aria-label={CAN_EDIT_CAMPUS ? 'Tags de ce niveau' : 'Salles de ce niveau'}>{visibleTags.map((tag, index) => {
      const course = courses.find((entry) => entry.id === tag.courseId);
      const destination = destinations.find((entry) => entry.kind === 'room' && entry.tag?.id === tag.id);
      const content = <><span className="fsm-plan-tag-number">{index + 1}</span><span><strong>{tag.label}</strong><small>{course ? `${course.room} · ${course.startTime}–${course.endTime}` : tag.courseId ? 'Cours associé indisponible · le tag est conservé' : CAN_EDIT_CAMPUS ? 'Tag local' : 'Salle repérée'}{!pointInFootprint(tag.point, building.polygons) && ' · Position à corriger'}</small></span></>;
      return <li key={tag.id} data-tag-id={tag.id}>
        {CAN_EDIT_CAMPUS ? <button type="button" className="fsm-plan-tag-edit" onClick={() => editTag(tag)} aria-label={`Éditer ${tag.label}`}>{content}<Pencil size={14} /></button> : <div className="fsm-plan-tag-edit">{content}</div>}
        {CAN_EDIT_CAMPUS && <button type="button" className="fsm-plan-icon" onClick={() => { setPendingDelete(tag); clearFeedback(); }} aria-label={`Supprimer le tag ${tag.label}`}><Trash2 size={16} /></button>}
        {CAN_EDIT_CAMPUS && course && <Link className="fsm-plan-course-link" to={scheduleEditUrl(course.id)}>Voir ce cours dans le planning</Link>}
        {!CAN_EDIT_CAMPUS && destination && <Link className="fsm-plan-course-link" to={navigationUrl(destination.id)}>Y aller</Link>}
      </li>;
    })}</ol>}
    {!visibleTags.length && !draft && <p className="fsm-plan-empty">Aucun repère ajouté à ce niveau.</p>}

    {CAN_EDIT_CAMPUS && pendingDelete && <div className="fsm-plan-confirm" role="alert"><p>Supprimer le tag « {pendingDelete.label} » ? Le cours reste dans le planning.</p><div className="fsm-plan-actions"><button type="button" className="fsm-plan-button" onClick={() => setPendingDelete(null)}>Annuler</button><button type="button" className="fsm-plan-button" onClick={() => {
      try { useBuildingTags.getState().deleteTag(pendingDelete); if (draft?.id === pendingDelete.id) setDraft(null); setPendingDelete(null); setMessage('Tag supprimé.'); } catch (failure) { report(failure); }
    }}>Supprimer le tag</button></div></div>}
    {CAN_EDIT_CAMPUS && storageStatus !== 'ready' && <div className="fsm-plan-warning" role="alert">
      <p>{storageStatus === 'corrupt' ? 'La copie locale des tags est illisible et a été conservée.' : storageStatus === 'conflict' ? 'Un autre onglet a modifié les tags. Vos changements sont conservés dans cet onglet.' : 'Les tags ne peuvent pas être enregistrés dans ce navigateur.'} Exportez les tags pour garder vos changements.</p>
      <div className="fsm-plan-actions">
        <button type="button" className="fsm-plan-button" onClick={() => storageStatus === 'unavailable' ? useBuildingTags.getState().retry() : setReplaceOriginal(true)}>{storageStatus === 'unavailable' ? 'Réessayer l’enregistrement' : 'Remplacer la copie locale'}</button>
        {originalRaw !== null && <button type="button" className="fsm-plan-button" onClick={() => exportTags(true)}>Télécharger la copie originale</button>}
      </div>
    </div>}
    {CAN_EDIT_CAMPUS && replaceOriginal && <div className="fsm-plan-confirm" role="alert"><p>Remplacer la copie locale par les tags de cet onglet ? Exportez d’abord les copies à conserver.</p><div className="fsm-plan-actions"><button type="button" className="fsm-plan-button" onClick={() => setReplaceOriginal(false)}>Annuler</button><button type="button" className="fsm-plan-button" onClick={() => { useBuildingTags.getState().retry(true); setReplaceOriginal(false); }}>Confirmer le remplacement</button></div></div>}
    {error && <p className="fsm-plan-error" role="alert">{error}</p>}
    {message && <p className="fsm-plan-message" role="status">{message}</p>}

    {CAN_EDIT_CAMPUS && <div className="fsm-plan-project"><button type="button" className="fsm-plan-button fsm-plan-primary" disabled={savingProject || !!draft || ['corrupt', 'conflict'].includes(storageStatus)} onClick={saveProject}><Save size={15} />{savingProject ? 'Enregistrement…' : 'Enregistrer dans le projet'}</button><p className="fsm-plan-hint">Enregistre les noms, niveaux et positions dans src/data/room-locations.json pour votre prochain déploiement.</p></div>}
    {CAN_EDIT_CAMPUS && <details className="fsm-plan-backup"><summary>Sauvegarder ou importer les tags</summary>
      <p className="fsm-plan-hint">Les tags restent dans ce navigateur. Cette sauvegarde contient les tags de tous les bâtiments, séparément du planning.</p>
      <div className="fsm-plan-actions"><button type="button" className="fsm-plan-button" onClick={() => exportTags()}><Download size={15} />Exporter les tags</button><button type="button" className="fsm-plan-button" onClick={() => importInput.current?.click()}><Upload size={15} />Importer les tags</button></div>
      <input ref={importInput} type="file" accept=".json,application/json" hidden aria-label="Sauvegarde des tags" onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; clearFeedback();
        try { if (file.size > 1_048_576) throw new Error('La sauvegarde dépasse 1 Mo.'); setPendingImport(parseBuildingTagsBackup(await file.text())); } catch (failure) { report(failure); }
      }} />
    </details>}
    {CAN_EDIT_CAMPUS && pendingImport && <div className="fsm-plan-confirm" role="alert"><p>Remplacer les {allTags.length} tags de ce navigateur par les {pendingImport.length} tags du fichier ? Le planning reste inchangé.</p><div className="fsm-plan-actions"><button type="button" className="fsm-plan-button" onClick={() => setPendingImport(null)}>Annuler</button><button type="button" className="fsm-plan-button" onClick={() => {
      try { useBuildingTags.getState().replaceTags(pendingImport); setPendingImport(null); setDraft(null); setMessage('Tags importés.'); } catch (failure) { report(failure); }
    }}>Remplacer tous les tags</button></div></div>}
  </section>;
}
