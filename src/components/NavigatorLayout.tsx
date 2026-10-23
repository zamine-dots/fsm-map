import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { CalendarDays, Compass, GraduationCap, Map, MapPin, Settings } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useResolvedTheme } from '../lib/useResolvedTheme';
import { SCHEDULE_STORAGE_KEY } from '../lib/storage';
import { useScheduleStore } from '../store/useScheduleStore';
import { BUILDING_TAGS_KEY } from '../lib/building-tags';
import { useBuildingTags } from '../store/useBuildingTags';

export default function NavigatorLayout() {
  const theme = useResolvedTheme();
  const { pathname, search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const isPlanning = pathname === '/schedule';
  const immersive = pathname === '/navigate' || (pathname === '/map' && params.get('navigate') === '1')
    || (isPlanning && (params.get('add') === '1' || params.has('edit') || hash === '#schedule-backup'));
  const isMap = pathname === '/map';
  const [viewportHeight, setViewportHeight] = useState<number | undefined>();
  useEffect(() => {
    if (!immersive) { setViewportHeight(undefined); return; }
    const update = () => setViewportHeight(Math.round(window.visualViewport?.height ?? window.innerHeight));
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { window.visualViewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, [immersive]);
  useLayoutEffect(() => {
    if (!isPlanning || !immersive) return;
    const field = document.activeElement;
    // A keyboard or rotation can shrink the dialog while the same input keeps focus.
    if (field instanceof HTMLElement && field.matches('input, select, textarea') && field.closest('.nav-schedule-form-body')) {
      field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [isPlanning, immersive, viewportHeight]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === SCHEDULE_STORAGE_KEY || event.key === null) useScheduleStore.getState().reloadStorage();
      if (event.key === BUILDING_TAGS_KEY || event.key === null) useBuildingTags.getState().reload();
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  return <div className="navigator-shell" data-theme={theme} data-immersive={immersive} data-map-page={isMap} data-planning-page={isPlanning}
    style={viewportHeight ? { height: viewportHeight, '--nav-viewport-height': `${viewportHeight}px` } as CSSProperties : undefined}>
    <a className="nav-skip-link" href="#navigator-main">Aller au contenu</a>
    <header className="nav-header flex items-center justify-between gap-4">
      <Link className="nav-brand flex min-w-0 items-center gap-3" to="/" aria-label="FSM Navigator, carte du campus">
        <span className="nav-brand-mark"><GraduationCap size={25} strokeWidth={1.6} /></span>
        <span><strong>FSM<span className="nav-brand-divider">/</span>Navigator</strong><small>FACULTÉ DES SCIENCES DE MONASTIR</small></span>
      </Link>
      <div className="flex items-center gap-4">
        <span className="nav-location"><MapPin size={14} />Monastir, Tunisie</span>
        <a className="nav-explorer-link" href="/explore"><Compass size={17} /><span>Plan détaillé</span></a>
      </div>
    </header>
    <main id="navigator-main" className="nav-main" tabIndex={-1}><Outlet /></main>
    <nav className="nav-tabs" aria-label="Navigation principale">
      <NavLink className={({ isActive }) => `nav-tab ${isActive ? 'is-active' : ''}`} to="/map"><Map size={21} /><span>Carte</span></NavLink>
      <NavLink className={({ isActive }) => `nav-tab ${isActive ? 'is-active' : ''}`} to="/schedule"><CalendarDays size={20} /><span>Planning</span></NavLink>
      <NavLink className={({ isActive }) => `nav-tab ${isActive ? 'is-active' : ''}`} to="/settings"><Settings size={21} /><span>Réglages</span></NavLink>
    </nav>
  </div>;
}
