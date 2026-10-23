import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useScheduleStore } from '../store/useScheduleStore';

export default function ScheduleStorageNotice() {
  const state = useScheduleStore((store) => store.storageState);
  if (state === 'ready') return null;
  return <div className="nav-schedule-warning" role="alert">
    <AlertTriangle size={19} />
    <div>
      <strong>{state === 'corrupt' ? 'La copie locale du planning est illisible.' : state === 'conflict' ? 'Un autre onglet a modifié votre planning.' : 'Le planning ne peut pas être enregistré ici.'}</strong>
      <p>{state === 'corrupt' ? 'Elle n’a pas été écrasée. Vos nouveaux cours restent dans cet onglet.' : 'Vos modifications restent dans cet onglet, mais peuvent être perdues en le fermant.'} Exportez-les pour les garder.</p>
      <Link to="/schedule#schedule-backup">Sauvegarde et récupération</Link>
    </div>
  </div>;
}
