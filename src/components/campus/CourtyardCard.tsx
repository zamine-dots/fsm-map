import { Footprints, MapPin, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COUR_ROUGE } from '../../lib/campus-landmarks';

export default function CourtyardCard({ onClose }: { onClose: () => void }) {
  return <aside className="nav-welcome-card nav-courtyard-card" role="region" aria-labelledby="courtyard-title" data-place-kind="courtyard">
    <header><span className="nav-eyebrow"><MapPin size={14} />{COUR_ROUGE.typeLabel}</span><button type="button" className="nav-icon-button" onClick={onClose} aria-label="Fermer le repère Cour Rouge"><X size={17} /></button></header>
    <h2 id="courtyard-title">{COUR_ROUGE.name}</h2>
    <Link className="nav-secondary-button" to="/map?navigate=1&from=cour-rouge"><Footprints size={17} />Partir d’ici</Link>
  </aside>;
}
