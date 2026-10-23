import { ArrowDownToLine, ArrowUpRight, Battery, Check, ChevronRight, Laptop, Layers2, Moon, ShieldCheck, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MODEL_URL, modelSizeLabel } from '../lib/model-assets';
import { useAppStore, type ThemePreference } from '../store/useAppStore';
import { campusData, campusStats } from '../lib/campus-catalog';
import { useScheduleStore } from '../store/useScheduleStore';
import { CAN_EDIT_CAMPUS } from '../lib/campus-editing';

const themes = [{ value: 'system', label: 'Système', icon: Laptop }, { value: 'light', label: 'Clair', icon: Sun }, { value: 'dark', label: 'Sombre', icon: Moon }] as const;

export default function SettingsPage() {
  const theme = useAppStore((state) => state.theme);
  const lowPower = useAppStore((state) => state.lowPower);
  const labels = useAppStore((state) => state.labels);
  const classCount = useScheduleStore((state) => state.classes.length);
  return <div className="nav-settings-page">
    <div className="nav-settings-heading"><span className="nav-eyebrow">À VOTRE FAÇON</span><h1>Un campus. Votre vue.</h1><p>Quelques réglages pour vous sentir chez vous.</p></div>
    <section className="nav-settings-card" aria-labelledby="appearance-title">
      <h2 id="appearance-title">Apparence</h2>
      <fieldset className="nav-theme-picker"><legend className="sr-only">Thème de l’interface</legend>{themes.map(({ value, label, icon: Icon }) => <label key={value} className={theme === value ? 'is-selected' : ''}><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => useAppStore.getState().setTheme(value as ThemePreference)} /><Icon size={22} /><span>{label}</span>{theme === value && <Check size={14} className="nav-theme-check" />}</label>)}</fieldset>
    </section>
    <section className="nav-settings-card" aria-labelledby="map-settings-title">
      <h2 id="map-settings-title">Votre carte</h2>
      <label className="nav-setting-row"><span className="nav-setting-icon"><Battery size={21} /></span><span className="nav-setting-copy"><strong>Mode économie d’énergie</strong><span>Sans ombres, rendu simplifié et résolution réduite.</span></span><input className="nav-switch" type="checkbox" role="switch" checked={lowPower} onChange={(event) => useAppStore.getState().setLowPower(event.target.checked)} aria-label="Mode économie d’énergie" /></label>
      <label className="nav-setting-row"><span className="nav-setting-icon"><Layers2 size={21} /></span><span className="nav-setting-copy"><strong>Repères sur la carte</strong><span>Afficher les noms de quelques lieux du campus.</span></span><input className="nav-switch" type="checkbox" role="switch" checked={labels} onChange={(event) => useAppStore.getState().setLabels(event.target.checked)} aria-label="Repères sur la carte" /></label>
      <Link className="nav-setting-row nav-setting-link" to="/map"><span className="nav-setting-copy"><strong>Retourner explorer</strong><span>Vos réglages s’appliquent immédiatement.</span></span><ChevronRight size={19} /></Link>
    </section>
    <section className="nav-settings-card" aria-labelledby="schedule-settings-title">
      <h2 id="schedule-settings-title">Votre planning personnel</h2>
      <p>{classCount} cours récurrent{classCount > 1 ? 's' : ''} · Les horaires suivent toujours {campusData.timezone}, même en voyage.</p>
      <Link className="nav-setting-row nav-setting-link" to="/schedule#schedule-backup"><span className="nav-setting-copy"><strong>Exporter, importer ou récupérer le planning</strong><span>Une sauvegarde JSON, sans compte et sans serveur.</span></span><ChevronRight size={19} /></Link>
    </section>
    <section className="nav-settings-card" aria-labelledby="campus-data-title">
      <h2 id="campus-data-title">Un modèle ouvert, un campus réel.</h2>
      <p>{campusStats.buildings} bâtiments FSM, issus d’OpenStreetMap. L’agencement des Amphis 1–6 intègre votre correction ; la hauteur de 7 m reste une estimation.</p>
      <Link className="nav-setting-row nav-setting-link" to="/map?view=list"><span className="nav-setting-copy"><strong>Parcourir les bâtiments sans 3D</strong><span>Recherche et fiches, même sans WebGL.</span></span><ChevronRight size={19} /></Link>
      <a className="nav-setting-row nav-setting-link" href={MODEL_URL} download="fsm-campus.glb"><span className="nav-setting-icon"><ArrowDownToLine size={21} /></span><span className="nav-setting-copy"><strong>Télécharger le modèle 3D</strong><span>GLB optimisé · {modelSizeLabel} · unités en mètres</span></span><ArrowDownToLine size={18} /></a>
      <a className="nav-setting-row nav-setting-link" href="/explore"><span className="nav-setting-copy"><strong>Ouvrir le plan détaillé original</strong><span>{CAN_EDIT_CAMPUS ? 'Recherche, salles, corrections locales et exports.' : 'Recherche, plan des salles et exports.'}</span></span><ArrowUpRight size={18} /></a>
      <p className="nav-fine-print">Source du {new Intl.DateTimeFormat(campusData.locale, { dateStyle: 'long', timeZone: campusData.timezone }).format(new Date(`${campusData.source.retrievedAt}T12:00:00Z`))}. <a href={campusData.source.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></p>
    </section>
    <div className="nav-privacy-note"><ShieldCheck size={20} /><p>Vos préférences et votre planning restent sur cet appareil si le stockage local est autorisé. Exportez une copie avant d’effacer les données du navigateur. Le GPS démarre à votre demande, reste en mémoire et s’arrête quand vous quittez l’écran Itinéraire. Aucune position n’est envoyée à un serveur.</p></div>
    <p className="nav-phase-note">Itinéraires piétons sur le plan du campus · Accès à vérifier sur place. Installation PWA à venir.</p>
  </div>;
}
