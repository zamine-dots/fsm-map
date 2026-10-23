import { useRef, useState, type ChangeEvent } from 'react';
import { Download, ShieldCheck, Upload } from 'lucide-react';
import type { ScheduleBackup } from '../data/types';
import { campusData, findBuilding } from '../lib/campus-catalog';
import { downloadTextFile, MAX_BACKUP_BYTES, parseScheduleBackup, serializeSchedule } from '../lib/storage';
import { scheduleContext, useScheduleStore } from '../store/useScheduleStore';
import { ConfirmDialog } from './AppDialog';

type RecoveryAction = 'replace' | 'reload' | 'clear';

export default function ScheduleBackupPanel() {
  const classes = useScheduleStore((state) => state.classes);
  const storageState = useScheduleStore((state) => state.storageState);
  const storageDetail = useScheduleStore((state) => state.storageDetail);
  const recoveryRaw = useScheduleStore((state) => state.recoveryRaw);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: ScheduleBackup; name: string } | null>(null);
  const [recovery, setRecovery] = useState<RecoveryAction | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  const exportFile = (raw = false) => {
    setError('');
    try {
      const filename = `fsm-planning-${new Date().toISOString().slice(0, 10)}`;
      if (raw && recoveryRaw !== null) downloadTextFile(recoveryRaw, `${filename}-copie-originale.txt`, 'text/plain');
      else downloadTextFile(serializeSchedule(classes, scheduleContext), `${filename}.json`);
      setMessage('Téléchargement lancé.');
    } catch {
      setError('Le téléchargement n’a pas pu démarrer. Autorisez les téléchargements dans votre navigateur, puis réessayez.');
    }
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage('');
    setError('');
    setReading(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Le fichier dépasse la limite de 1 Mo.');
      const backup = parseScheduleBackup(await file.text(), scheduleContext);
      setPending({ backup, name: file.name });
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Impossible de lire ce fichier.'} Aucun cours n’a été modifié.`);
    } finally {
      setReading(false);
    }
  };

  const confirmRecovery = () => {
    const store = useScheduleStore.getState();
    if (recovery === 'clear') store.replaceClasses([]);
    if (recovery === 'replace') store.retrySave(true);
    if (recovery === 'reload') store.reloadStorage(true);
    setRecovery(null);
    setMessage(useScheduleStore.getState().storageState === 'ready'
      ? 'Le planning et sa copie locale sont à jour.'
      : 'Le stockage reste indisponible ou illisible. Exportez le planning de cet onglet.');
  };

  return <section className="nav-backup-panel" id="schedule-backup" aria-labelledby="schedule-backup-title">
    <div className="nav-section-heading"><h2 id="schedule-backup-title"><ShieldCheck size={19} />Sauvegarde</h2></div>
    <p>Votre planning reste sur cet appareil. Exportez une copie pour le retrouver ailleurs.</p>
    <div className="nav-backup-actions">
      <button type="button" className="nav-secondary-button" onClick={() => exportFile()}><Download size={17} />Exporter le planning</button>
      <button type="button" className="nav-secondary-button" disabled={reading} onClick={() => input.current?.click()}><Upload size={17} />{reading ? 'Lecture du fichier…' : 'Importer un planning'}</button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="Fichier de sauvegarde du planning" hidden onChange={readFile} />
    </div>
    {storageState !== 'ready' && <div className="nav-backup-recovery">
      <h3>Récupérer sans perdre vos données</h3>
      {storageDetail && <p>{storageDetail}</p>}
      <p>Exportez d’abord les cours de cet onglet. Une copie illisible n’est jamais remplacée sans votre accord.</p>
      <div className="nav-backup-actions">
        {recoveryRaw !== null && <button className="nav-secondary-button" type="button" onClick={() => exportFile(true)}>Télécharger la copie originale</button>}
        {storageState === 'unavailable' ? <button className="nav-secondary-button" type="button" onClick={() => useScheduleStore.getState().retrySave()}>Réessayer l’enregistrement</button> : <>
          <button className="nav-secondary-button" type="button" onClick={() => setRecovery('replace')}>Enregistrer ce planning à la place</button>
          {storageState === 'conflict' && <button className="nav-secondary-button" type="button" onClick={() => setRecovery('reload')}>Recharger la copie enregistrée</button>}
        </>}
      </div>
    </div>}
    {error && <p className="nav-form-error" role="alert">{error}</p>}
    {message && <p className="nav-save-message" role="status">{message}</p>}
    <div className="nav-backup-foot"><span>Version 1 · {campusData.timezone} · 1 Mo maximum</span><button type="button" className="nav-text-button" onClick={() => setRecovery('clear')}>Effacer le planning</button></div>

    {pending && <ConfirmDialog title="Remplacer votre planning ?" confirmLabel="Remplacer le planning" onClose={() => setPending(null)} onConfirm={() => {
      useScheduleStore.getState().replaceClasses(pending.backup.classes);
      setMessage(`${pending.backup.classes.length} cours récurrents importés. ${useScheduleStore.getState().storageState === 'ready' ? 'La copie locale est enregistrée.' : 'Exportez une copie : le stockage local n’est pas disponible.'}`);
      setPending(null);
    }}>
      <p><strong>{pending.name}</strong> contient {pending.backup.classes.length} cours récurrents et remplacera les {classes.length} cours de cet onglet, ainsi que la copie locale.</p>
      <p>Sauvegarde du {new Intl.DateTimeFormat('fr-FR', { timeZone: campusData.timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(pending.backup.exportedAt))}, heure de Monastir.</p>
      {pending.backup.classes.some((course) => !findBuilding(course.buildingId)) && <p className="nav-inline-warning">Certains bâtiments ne figurent plus dans le catalogue. Les cours seront conservés, mais leur bâtiment devra être corrigé avant de les afficher sur la carte.</p>}
      <p>Cette action n’est pas annulable. Exportez le planning actuel avant de continuer si vous voulez le conserver.</p>
    </ConfirmDialog>}
    {recovery && <ConfirmDialog title={recovery === 'clear' ? 'Effacer tous les cours ?' : recovery === 'reload' ? 'Recharger la copie locale ?' : 'Remplacer la copie locale ?'}
      confirmLabel={recovery === 'clear' ? 'Tout effacer' : recovery === 'reload' ? 'Recharger le planning' : 'Enregistrer à la place'} danger={recovery === 'clear'} onClose={() => setRecovery(null)} onConfirm={confirmRecovery}>
      <p>{recovery === 'clear' ? 'Les cours de cet onglet et la copie locale seront remplacés par un planning vide. Les préférences, le modèle et les corrections du plan détaillé ne seront pas touchés.' : recovery === 'reload' ? 'Les changements non enregistrés de cet onglet seront abandonnés si la copie locale est lisible.' : 'Le planning de cet onglet remplacera la copie locale, y compris les changements d’un autre onglet ou les données illisibles.'}</p>
      <p>Exportez les données que vous voulez garder avant de confirmer.</p>
    </ConfirmDialog>}
  </section>;
}
