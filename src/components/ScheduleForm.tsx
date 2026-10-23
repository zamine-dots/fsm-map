import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronDown, MapPin, Search } from 'lucide-react';
import type { ScheduledClass, Weekday } from '../data/types';
import { campusBuildings, campusStats, findBuilding } from '../lib/campus-catalog';
import { createScheduleId, overlappingClasses, parseScheduledClass, scheduleTitle, searchCourseCatalog, WEEKDAYS } from '../lib/schedule';
import { useScheduleStore } from '../store/useScheduleStore';
import { findOfficialRoom, officialRooms } from '../lib/official-rooms';
import { findMappedRoom, normalizeRoomName } from '../lib/room-names';
import { publishedRoomTags } from '../lib/published-room-locations';
import AppDialog from './AppDialog';

export default function ScheduleForm({ existing, initialBuildingId, initialCode, initialRoomName, onClose, onSaved }: {
  existing?: ScheduledClass; initialBuildingId?: string; initialCode?: string; initialRoomName?: string; onClose: () => void; onSaved: (course: ScheduledClass) => void;
}) {
  const classes = useScheduleStore((state) => state.classes);
  const [original] = useState(existing);
  const startingBuilding = existing?.buildingId ?? initialBuildingId ?? '';
  const startingCourse = findBuilding(startingBuilding)?.classes.find((course) => course.code === (existing?.catalogCode ?? initialCode));
  const [mode, setMode] = useState<'custom' | 'catalog'>(startingCourse ? 'catalog' : 'custom');
  const [draft, setDraft] = useState<ScheduledClass>(() => existing ?? {
    id: createScheduleId(), buildingId: startingBuilding, catalogCode: startingCourse?.code ?? null,
    title: startingCourse?.title ?? '', room: startingCourse?.room ?? initialRoomName?.slice(0, 100) ?? '', floor: startingCourse?.floor ?? null,
    label: '', days: [], startTime: '', endTime: '',
  });
  const [step, setStep] = useState<0 | 1>(0);
  const [floorInput, setFloorInput] = useState(() => String(draft.floor ?? ''));
  const [detailsOpen, setDetailsOpen] = useState(draft.floor !== null || Boolean(draft.label));
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const errorHeading = useRef<HTMLParagraphElement>(null);
  const floorField = useRef<HTMLInputElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const building = findBuilding(draft.buildingId);
  const roomSuggestions = useMemo(() => {
    const options = new Map((building?.rooms ?? []).map((room) => [normalizeRoomName(room.name), { value: room.name, label: 'Salle du bâtiment' }]));
    for (const room of publishedRoomTags.filter((room) => room.buildingId === building?.id)) options.set(normalizeRoomName(room.label), { value: room.label, label: 'Salle repérée dans le bâtiment' });
    for (const room of officialRooms) if (!options.has(normalizeRoomName(room.name))) options.set(normalizeRoomName(room.name), {
      value: room.name, label: building && findMappedRoom(building, room.name) ? 'Salle du bâtiment' : 'Planning officiel · bâtiment à confirmer',
    });
    return [...options.values()];
  }, [building]);
  const unlocatedOfficialRoom = !!findOfficialRoom(draft.room) && !(building && findMappedRoom(building, draft.room)) && !publishedRoomTags.some((room) => room.buildingId === draft.buildingId && normalizeRoomName(room.label).replaceAll(' ', '') === normalizeRoomName(draft.room).replaceAll(' ', ''));
  const results = useMemo(() => searchCourseCatalog(campusBuildings, query), [query]);
  const selectedKey = draft.catalogCode ? JSON.stringify([draft.buildingId, draft.catalogCode]) : '';
  const selectedEntry = draft.catalogCode ? searchCourseCatalog(campusBuildings, '').find((entry) => entry.building.id === draft.buildingId && entry.course.code === draft.catalogCode) : undefined;
  const visibleResults = results.slice(0, 100);
  const overlaps = overlappingClasses(draft, classes);
  const change = <Key extends keyof ScheduledClass>(key: Key, value: ScheduledClass[Key]) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => { if (error) errorHeading.current?.focus(); }, [error]);
  useEffect(() => {
    if (step !== previousStep.current) stepHeading.current?.focus();
    previousStep.current = step;
  }, [step]);

  const toggleDay = (day: Weekday) => change('days', draft.days.includes(day) ? draft.days.filter((entry) => entry !== day) : [...draft.days, day]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      if (!building) throw new Error('Choisissez un bâtiment.');
      if (mode === 'catalog' && !selectedEntry) throw new Error('Choisissez un cours du catalogue.');
      const floor = floorInput.trim() === '' ? null : Number(floorInput);
      if (floorField.current?.validity.badInput) throw new Error('Indiquez un niveau entier, ou laissez-le vide.');
      if (step === 0) {
        // Validate the course details with the same parser used for storage and imports.
        parseScheduledClass({ ...draft, floor, days: [1], startTime: '09:00', endTime: '10:00' });
        setStep(1);
        return;
      }
      if (original && JSON.stringify(useScheduleStore.getState().classes.find((course) => course.id === original.id)) !== JSON.stringify(original)) {
        throw new Error('Ce cours a changé dans un autre onglet. Fermez puis rouvrez-le.');
      }
      if (!draft.days.length) throw new Error('Choisissez au moins un jour.');
      if (!draft.startTime || !draft.endTime) throw new Error('Indiquez les heures de début et de fin.');
      if (draft.endTime <= draft.startTime) throw new Error('La fin doit être après le début, le même jour.');
      const saved = parseScheduledClass({ ...draft, floor });
      useScheduleStore.getState().saveClass(saved);
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Le cours n’a pas pu être enregistré.');
      errorHeading.current?.focus();
    }
  };

  return <AppDialog title={existing ? 'Modifier le cours' : 'Ajouter un cours'} onClose={onClose} fullScreen>
    <form className="nav-schedule-form" onSubmit={submit} noValidate data-step={step + 1}>
      <div className="nav-schedule-form-body">
        <div className="nav-schedule-step">
          <div className="nav-schedule-progress" aria-label={`Étape ${step + 1} sur 2`}><span data-complete="true" /><span data-complete={step === 1} /></div>
          <div className="nav-schedule-step-heading"><span>{step + 1} / 2</span><h3 ref={stepHeading} tabIndex={-1}>{step === 0 ? 'Votre cours' : 'À quel moment ?'}</h3></div>
          {error && <p className="nav-form-error" role="alert" tabIndex={-1} ref={errorHeading}>{error}</p>}

          {step === 0 ? <>
            {campusStats.classes > 0 && <fieldset className="nav-form-mode"><legend>Source du cours</legend>
              <label><input type="radio" name="course-source" checked={mode === 'catalog'} onChange={() => setMode('catalog')} />Catalogue</label>
              <label><input type="radio" name="course-source" checked={mode === 'custom'} onChange={() => { setMode('custom'); change('catalogCode', null); }} />Saisie libre</label>
            </fieldset>}
            {mode === 'catalog' && <div className="nav-catalog-picker">
              <label className="nav-field"><span><Search size={15} />Rechercher un cours</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, matière…" /></label>
              <label className="nav-field"><span id="schedule-catalog-label">Cours du catalogue</span><select aria-labelledby="schedule-catalog-label" value={selectedEntry ? selectedKey : ''} onChange={(event) => {
                const entry = searchCourseCatalog(campusBuildings, '').find(({ building: candidate, course }) => JSON.stringify([candidate.id, course.code]) === event.target.value);
                if (!entry) { change('catalogCode', null); return; }
                setDraft((current) => ({ ...current, buildingId: entry.building.id, catalogCode: entry.course.code, title: entry.course.title, room: entry.course.room, floor: entry.course.floor }));
                setFloorInput(String(entry.course.floor ?? ''));
              }} required>
                <option value="">Choisir un cours</option>
                {selectedEntry && !visibleResults.some((entry) => entry.building.id === selectedEntry.building.id && entry.course.code === selectedEntry.course.code) && <option value={selectedKey}>{selectedEntry.course.code} · {selectedEntry.course.title}</option>}
                {visibleResults.map((entry) => <option key={JSON.stringify([entry.building.id, entry.course.code])} value={JSON.stringify([entry.building.id, entry.course.code])}>{entry.course.code} · {entry.course.title} — {entry.building.shortCode}</option>)}
              </select></label>
              {results.length > 100 && <p className="nav-field-hint">Précisez votre recherche.</p>}
            </div>}
            <label className="nav-field"><span>Intitulé du cours</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} maxLength={160} placeholder="Ex. Analyse" autoComplete="off" enterKeyHint="next" required /></label>
            <label className="nav-field"><span id="schedule-building-label">Bâtiment</span><select aria-labelledby="schedule-building-label" value={draft.buildingId} disabled={mode === 'catalog'} onChange={(event) => setDraft((current) => ({ ...current, buildingId: event.target.value, catalogCode: null }))} required>
              <option value="">Choisir un bâtiment</option>
              {draft.buildingId && !building && <option value={draft.buildingId}>Bâtiment à remplacer</option>}
              {campusBuildings.map((entry) => <option key={entry.id} value={entry.id}>{entry.shortName} · {entry.shortCode}</option>)}
            </select></label>
            <label className="nav-field"><span id="schedule-room-label">Salle</span><input value={draft.room} onChange={(event) => change('room', event.target.value)} maxLength={100} placeholder="Ex. Amphi 2" list="schedule-room-options" autoComplete="off" enterKeyHint="next" aria-labelledby="schedule-room-label" aria-describedby={unlocatedOfficialRoom ? 'schedule-room-help' : undefined} required /><datalist id="schedule-room-options">{roomSuggestions.map((room) => <option key={room.value} value={room.value} label={room.label} />)}</datalist>{unlocatedOfficialRoom && <span className="nav-field-hint" id="schedule-room-help">Vérifiez le bâtiment de cette salle.</span>}</label>
            <details className="nav-schedule-extra" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
              <summary>Plus de détails <span>Facultatif</span><ChevronDown size={17} /></summary>
              <div>
                <label className="nav-field"><span id="schedule-floor-label">Niveau</span><input ref={floorField} type="number" value={floorInput} onChange={(event) => setFloorInput(event.target.value)} min={-20} max={200} step={1} placeholder="Inconnu" aria-labelledby="schedule-floor-label" aria-describedby="schedule-floor-help" /><span className="nav-field-hint" id="schedule-floor-help">0 = RDC · vide = inconnu</span></label>
                <label className="nav-field"><span>Libellé personnel</span><input value={draft.label} onChange={(event) => change('label', event.target.value)} maxLength={100} placeholder="Ex. TD groupe A" /></label>
              </div>
            </details>
          </> : <>
            <div className="nav-schedule-recap"><MapPin size={19} /><div><strong>{scheduleTitle(draft)}</strong><span>{draft.room} · {building?.shortName}</span></div></div>
            <fieldset className="nav-day-field"><legend>Jours de cours <small>Chaque semaine</small></legend><div className="nav-weekday-checks">{WEEKDAYS.map((day) => <label key={day.value} data-checked={draft.days.includes(day.value)}><input type="checkbox" checked={draft.days.includes(day.value)} onChange={() => toggleDay(day.value)} aria-label={day.label} /><span aria-hidden="true">{day.short}</span></label>)}</div></fieldset>
            <div className="nav-form-columns">
              <label className="nav-field"><span>Début</span><input type="time" step={60} value={draft.startTime} onChange={(event) => change('startTime', event.target.value)} required /></label>
              <label className="nav-field"><span>Fin</span><input type="time" step={60} value={draft.endTime} onChange={(event) => change('endTime', event.target.value)} required /></label>
            </div>
            <p className="nav-schedule-timezone">Heure de Monastir</p>
            {overlaps.length > 0 && <div className="nav-inline-warning" role="status"><AlertTriangle size={17} /><span>Chevauchement avec {overlaps.slice(0, 3).map(scheduleTitle).join(', ')}{overlaps.length > 3 ? ` (+${overlaps.length - 3})` : ''}.</span></div>}
          </>}
        </div>
      </div>
      <footer className="nav-schedule-form-footer"><div>
        <button type="button" className="nav-secondary-button" onClick={() => { if (step === 0) onClose(); else { setError(''); setStep(0); } }}>{step === 0 ? 'Annuler' : 'Retour'}</button>
        <button type="submit" className="nav-primary-button">{step === 0 ? <>Continuer<ArrowRight size={18} /></> : <><Check size={18} />{existing ? 'Enregistrer' : 'Ajouter au planning'}</>}</button>
      </div></footer>
    </form>
  </AppDialog>;
}
