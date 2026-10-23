import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronRight, DoorOpen, ExternalLink, Layers3, Pencil, Ruler, X } from 'lucide-react';
import { CATEGORY_META, type CampusBuilding, type Coordinate } from '../lib/campus';
import BuildingPreview from './BuildingPreview';
import { CAN_EDIT_CAMPUS } from '../lib/campus-editing';

const BuildingPlan2D = lazy(() => import('./BuildingPlan2D'));

interface Props {
  building: CampusBuilding;
  origin: Coordinate;
  indoor: boolean;
  floor: number;
  selectedRoom: string | null;
  onClose: () => void;
  onEdit: () => void;
  onIndoor: (enabled: boolean) => void;
  onFloor: (level: number) => void;
  onRoom: (id: string) => void;
  onFocus: () => void;
  onFocusCour?: () => void;
}

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export default function BuildingPanel({ building, origin, indoor, floor, selectedRoom, onClose, onEdit, onIndoor, onFloor, onRoom, onFocus, onFocusCour }: Props) {
  const [preview, setPreview] = useState<'2d' | 'volume'>('2d');
  const category = CATEGORY_META[building.category];
  const floors = [...new Set(building.rooms.flatMap((room) => room.levels))].sort((first, second) => first - second);
  const rooms = building.rooms.filter((room) => room.levels.includes(floor)).sort((first, second) => first.name.localeCompare(second.name, 'fr', { numeric: true }));
  const hasSides = building.rooms.some((room) => room.side);
  const groups = hasSides ? [
    { side: 'front', label: 'Face avant', rooms: rooms.filter((room) => room.side === 'front') },
    { side: 'rear', label: 'Face arrière', rooms: rooms.filter((room) => room.side === 'rear') },
    { side: 'other', label: 'Autres espaces', rooms: rooms.filter((room) => !room.side) },
  ].filter((group) => group.rooms.length) : [{ side: 'all', label: '', rooms }];
  return (
    <aside className="building-panel" aria-label={`Détails : ${building.name}`}>
      <div className="panel-topline">
        <span className="category-label"><span style={{ backgroundColor: category.color }} />{category.label}</span>
        <button className="icon-button small" aria-label="Fermer les détails du bâtiment" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="panel-scroll">
        <h2>{building.name}</h2>
        <p className="panel-location">Faculté des Sciences de Monastir</p>
        {hasSides && <div className="building-sides">{(['front', 'rear'] as const).map((side) => <p key={side}><span>{side === 'front' ? 'Face avant' : 'Face arrière'}</span><strong>{building.rooms.filter((room) => room.side === side).map((room) => room.name).join(' · ')}</strong></p>)}</div>}
        {!indoor && <>
          <div className="fsm-preview-tabs" role="group" aria-label="Aperçu du bâtiment">
            <button type="button" aria-pressed={preview === '2d'} onClick={() => setPreview('2d')}>{CAN_EDIT_CAMPUS ? 'Plan 2D & tags' : 'Plan des salles'}</button>
            <button type="button" aria-pressed={preview === 'volume'} onClick={() => setPreview('volume')}>Volume 3D</button>
          </div>
          {preview === 'volume' ? <BuildingPreview building={building} /> : <Suspense fallback={<p className="small-note" role="status">Chargement du plan 2D…</p>}>
            <BuildingPlan2D buildingId={building.id} building={building} origin={origin} onFocusCour={onFocusCour} />
          </Suspense>}
        </>}
        {indoor ? (
          <div className="indoor-details">
            <button className="text-button back-button" onClick={() => onIndoor(false)}><ArrowLeft size={15} />Revenir au bâtiment</button>
            <div className="floor-heading"><span>Explorer un niveau</span><Layers3 size={16} /></div>
            <div className="floor-tabs" aria-label="Niveau du bâtiment">
              {floors.map((level) => <button key={level} aria-pressed={floor === level} className={floor === level ? 'active' : ''} onClick={() => onFloor(level)}>{level === 0 ? 'RDC' : `Étage ${level}`}</button>)}
            </div>
            <p className="small-note">{rooms.length} espaces cartographiés à ce niveau. Le plan intérieur est partiel.</p>
            {building.levelsFromRooms && <p className="small-note">Les mêmes amphithéâtres occupent les niveaux 0–1 : ils sont à double hauteur.</p>}
            <div className="room-list">
              {groups.map((group) => <section className="room-side-group" key={group.side} aria-label={group.label || 'Salles du niveau'}>
              {group.label && <h3>{group.label}</h3>}
              {group.rooms.map((room) => <button key={room.id} className={`room-item ${selectedRoom === room.id ? 'active' : ''}`} onClick={() => onRoom(room.id)}>
                {room.type === 'library' ? <BookOpen size={17} /> : <DoorOpen size={17} />}
                <span><strong>{room.name}</strong><small>{room.type === 'library' ? 'Bibliothèque' : room.type === 'toilets' ? 'Sanitaires' : room.type === 'amphitheatre' ? 'Amphithéâtre' : 'Salle'} · {numberFormat.format(room.area)} m²</small></span>
                {selectedRoom === room.id ? <Check size={16} /> : <ChevronRight size={15} />}
              </button>)}
              </section>)}
            </div>
          </div>
        ) : (
          <>
            <div className="building-metrics">
              <div><Ruler size={15} /><strong>{numberFormat.format(building.area)} <small>m²</small></strong><span>Emprise au sol</span></div>
              <div><Layers3 size={15} /><strong>{building.levels} <small>{building.levels > 1 ? 'niveaux' : 'niveau'}</small></strong><span>{building.edited ? 'Correction locale' : building.levelsFromRooms ? 'Niveaux des salles' : building.levelsEstimated ? 'Niveaux estimés' : 'Niveaux OSM'}</span></div>
            </div>
            <div className="height-note"><span className="status-dot amber" />Hauteur {building.heightEstimated ? 'estimée' : 'OSM'} : {building.height.toLocaleString('fr-FR')} m</div>
            {building.rooms.length > 0 ? <button className="primary-button indoor-button" onClick={() => onIndoor(true)}><DoorOpen size={17} />{hasSides ? 'Explorer les amphis' : 'Explorer les salles'}<span className="button-count">{building.rooms.length}</span><ChevronRight size={16} /></button> : <p className="unmapped-note"><DoorOpen size={16} />Plan intérieur non renseigné</p>}
            {!building.named && <p className="small-note">Le nom de ce bâtiment reste à confirmer.{CAN_EDIT_CAMPUS && ' Vous pouvez ajouter votre correction.'}</p>}
            <button className="secondary-button focus-button" onClick={onFocus}>Centrer sur ce bâtiment<ArrowUpRight size={17} /></button>
          </>
        )}
      </div>
      <div className="panel-footer">{CAN_EDIT_CAMPUS && <button className="text-button" onClick={onEdit}><Pencil size={14} />Ajuster les détails</button>}<a href={`https://www.openstreetmap.org/${building.id}`} target="_blank" rel="noreferrer" aria-label="Voir la source du bâtiment dans OpenStreetMap" title="Source OpenStreetMap"><ExternalLink size={15} /></a></div>
    </aside>
  );
}
