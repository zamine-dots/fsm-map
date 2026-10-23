import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import NavigatorLayout from './components/NavigatorLayout';
import MapPage from './pages/Map';
import SchedulePage from './pages/Schedule';
import SettingsPage from './pages/Settings';

const OriginalExplorer = lazy(() => import('./App'));

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="nav-boot-loading" role="alert"><h1>La page n’a pas pu se charger.</h1><p>Vérifiez votre connexion, puis réessayez.</p><button type="button" onClick={() => window.location.reload()}>Recharger la page</button><a href="/explore">Ouvrir le plan détaillé</a></main>;
    return this.props.children;
  }
}

function StartPage() {
  const { search } = useLocation();
  const building = new URLSearchParams(search).get('building');
  return <Navigate replace to={building ? `/explore${search}` : '/map'} />;
}

function NavigationRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('navigate', '1');
  return <Navigate replace to={`/map?${params}`} />;
}

export default function NavigatorApp() {
  return <AppBoundary><BrowserRouter>
    <Routes>
      <Route element={<NavigatorLayout />}>
        <Route index element={<StartPage />} />
        <Route path="today" element={<Navigate replace to="/schedule" />} />
        <Route path="map" element={<MapPage />} />
        <Route path="navigate" element={<NavigationRedirect />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="nav-not-found"><h1>Cette page n’existe pas.</h1><Link className="nav-primary-button" to="/map">Revenir à la carte</Link></div>} />
      </Route>
      <Route path="explore" element={<Suspense fallback={<div className="nav-boot-loading" role="status">Ouverture du plan détaillé…</div>}><OriginalExplorer /></Suspense>} />
    </Routes>
  </BrowserRouter></AppBoundary>;
}
