import { Compass } from 'lucide-react';

export default function MapLoading({ progress = 0 }: { progress?: number }) {
  return <div className="nav-map-loading" role="status" aria-live="polite">
    <span className="nav-loading-mark"><Compass size={32} strokeWidth={1.4} /></span>
    <h2>Votre campus prend forme.</h2>
    <p>{progress > 0 ? `Chargement du modèle · ${progress} %` : 'Préparation de la carte 3D…'}</p>
    <progress aria-label="Chargement de la carte" max={100} value={progress > 0 ? progress : undefined} />
    <span>Faculté des Sciences de Monastir</span>
  </div>;
}
