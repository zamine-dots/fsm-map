import { useCallback, useState } from 'react';
import { Check, Ellipsis, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { ScheduledClass, Weekday } from '../data/types';
import AppDialog, { ConfirmDialog } from '../components/AppDialog';
import ScheduleBackupPanel from '../components/ScheduleBackupPanel';
import ScheduleForm from '../components/ScheduleForm';
import ScheduleStorageNotice from '../components/ScheduleStorageNotice';
import WeeklyTimetable from '../components/WeeklyTimetable';
import { campusData } from '../lib/campus-catalog';
import { getCampusClock, scheduleAddUrl, scheduleTitle } from '../lib/schedule';
import { useNow } from '../lib/useNow';
import { useScheduleStore } from '../store/useScheduleStore';

export default function SchedulePage() {
  const classes = useScheduleStore((state) => state.classes);
  const storageState = useScheduleStore((state) => state.storageState);
  const now = useNow();
  const clock = getCampusClock(now, campusData.timezone);
  const [selectedDay, setSelectedDay] = useState<Weekday | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledClass | null>(null);
  const [message, setMessage] = useState('');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const backupOpen = location.hash === '#schedule-backup';
  const closeBackup = () => navigate({ pathname: '/schedule', search: location.search }, { replace: true });
  const editId = params.get('edit');
  const existing = classes.find((course) => course.id === editId);
  const adding = params.get('add') === '1';
  const closeForm = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const key of ['edit', 'add', 'building', 'code', 'room']) next.delete(key);
    return next;
  }, { replace: true }), [setParams]);

  const saved = (course: ScheduledClass) => {
    setSelectedDay(course.days.includes(clock.weekday) ? clock.weekday : course.days[0]);
    setMessage(existing ? 'Cours modifié.' : 'Cours ajouté.');
    closeForm();
  };

  return <div className="nav-planning-page nav-schedule-page">
    <header className="nav-planning-heading"><div><h1>Planning</h1><p>Chaque semaine</p></div><div className="nav-planning-heading-actions"><Link className="nav-icon-button" to="/schedule#schedule-backup" aria-label="Options du planning"><Ellipsis size={22} /></Link><Link className="nav-primary-button" to={scheduleAddUrl()} aria-label="Ajouter un cours"><Plus size={20} /><span>Ajouter</span></Link></div></header>
    <ScheduleStorageNotice />
    {message && <p className="nav-save-message" role="status"><Check size={16} />{message}{storageState !== 'ready' && ' Exportez une copie.'}</p>}
    {editId && !existing && <div className="nav-schedule-warning" role="alert"><div><strong>Ce cours n’est plus dans le planning.</strong><button className="nav-text-button" type="button" onClick={closeForm}>Revenir au planning</button></div></div>}
    <WeeklyTimetable classes={classes} clock={clock} selectedDay={selectedDay ?? clock.weekday} onDayChange={setSelectedDay} onDelete={setPendingDelete} />
    {backupOpen && <AppDialog title="Options du planning" onClose={closeBackup} fullScreen><div className="nav-schedule-backup-body"><ScheduleBackupPanel /></div></AppDialog>}
    {(existing || (adding && !editId)) && <ScheduleForm key={editId ?? `new:${params.get('building') ?? ''}:${params.get('code') ?? ''}:${params.get('room') ?? ''}`} existing={existing} initialBuildingId={params.get('building') ?? undefined} initialCode={params.get('code') ?? undefined} initialRoomName={params.get('room') ?? undefined} onClose={closeForm} onSaved={saved} />}
    {pendingDelete && <ConfirmDialog title="Supprimer ce cours ?" confirmLabel="Supprimer le cours" danger onClose={() => setPendingDelete(null)} onConfirm={() => {
      useScheduleStore.getState().deleteClass(pendingDelete.id);
      setMessage('Cours supprimé.');
      setPendingDelete(null);
    }}><p><strong>{scheduleTitle(pendingDelete)}</strong> sera retiré de tous les jours du planning.</p></ConfirmDialog>}
  </div>;
}
