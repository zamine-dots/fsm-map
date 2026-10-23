import { useCallback, useEffect, useRef, useState } from 'react';
import { project, type Coordinate } from './campus';
import { campusData } from './campus-catalog';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  timestamp: number;
}

const MAX_FIX_AGE = 30_000;
const MAX_ROUTE_ACCURACY = 50;
const ACQUISITION_TIME = 30_000;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };

export function formatLocationAccuracy(accuracy: number): string {
  return accuracy >= 1000 ? `${Math.round(accuracy / 1000)} km` : `${Math.round(accuracy)} m`;
}

function validLocationFix(fix: LocationFix, now: number): boolean {
  return [fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(Number.isFinite) && Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 && fix.accuracy >= 0 && fix.timestamp <= now + 10_000;
}

export function locationIssue(fix: LocationFix, now = Date.now()): string | null {
  if (!validLocationFix(fix, now)) return 'Position invalide. Réessayez.';
  if (fix.accuracy > MAX_ROUTE_ACCURACY) return `Position trop imprécise (±${formatLocationAccuracy(fix.accuracy)}). Activez la position précise.`;
  if (now - fix.timestamp > MAX_FIX_AGE) return 'Le signal GPS n’est plus à jour.';
  return null;
}

/** A coarse update cannot displace a still-fresh GPS fix. New precise fixes follow the walker. */
export function selectLocationFix(current: LocationFix | null, incoming: LocationFix, now = Date.now()): LocationFix | null {
  if (!validLocationFix(incoming, now) || now - incoming.timestamp > MAX_FIX_AGE) return current;
  if (!current || !validLocationFix(current, now) || now - current.timestamp > MAX_FIX_AGE) return incoming;
  if (current.accuracy <= MAX_ROUTE_ACCURACY && (incoming.accuracy > MAX_ROUTE_ACCURACY || incoming.timestamp < current.timestamp)) return current;
  if (current.accuracy > MAX_ROUTE_ACCURACY && incoming.accuracy > current.accuracy) return current;
  return incoming;
}

export function locationPoint(fix: LocationFix): Coordinate {
  return project([fix.longitude, fix.latitude], [campusData.coordinates.origin.lng, campusData.coordinates.origin.lat]);
}

/** A watch belongs to this screen, requests permission only on a tap, and never persists a fix. */
export function useLiveLocation() {
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [tracking, setTracking] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  const watch = useRef<number | null>(null);
  const provider = useRef<Geolocation | null>(null);
  const bestFix = useRef<LocationFix | null>(null);
  const deadline = useRef<number | null>(null);
  const generation = useRef(0);
  const clearDeadline = useCallback(() => {
    if (deadline.current !== null) window.clearTimeout(deadline.current);
    deadline.current = null;
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    if (watch.current !== null) provider.current?.clearWatch(watch.current);
    watch.current = null;
    provider.current = null;
    clearDeadline();
  }, [clearDeadline]);
  const stop = useCallback(() => {
    clear(); bestFix.current = null; setTracking(false); setSeeking(false); setFix(null); setError(null);
  }, [clear]);
  const start = useCallback(() => {
    clear(); bestFix.current = null; setFix(null); setError(null); setTracking(false); setSeeking(false); setClock(Date.now());
    if (!window.isSecureContext) { setError('Le GPS nécessite HTTPS. Placez votre départ sur la carte.'); return; }
    if (!navigator.geolocation) { setError('GPS indisponible sur ce navigateur. Placez un point.'); return; }
    const gps = navigator.geolocation;
    provider.current = gps;
    setTracking(true); setSeeking(true);
    const request = generation.current;
    deadline.current = window.setTimeout(() => {
      if (request !== generation.current) return;
      deadline.current = null;
      setSeeking(false); setClock(Date.now());
      if (!bestFix.current) setError('Aucune position GPS. Placez votre départ sur la carte.');
    }, ACQUISITION_TIME);
    const success = (position: GeolocationPosition) => {
      if (request !== generation.current) return;
      const now = Date.now();
      const { latitude, longitude, accuracy, heading } = position.coords;
      const incoming = { latitude, longitude, accuracy, heading: heading !== null && Number.isFinite(heading) ? heading : null, timestamp: position.timestamp };
      const selected = selectLocationFix(bestFix.current, incoming, now);
      if (!selected) return;
      bestFix.current = selected;
      setFix(selected); setError(null); setClock(now);
      if (!locationIssue(selected, now)) { clearDeadline(); setSeeking(false); }
    };
    const failure = (problem: GeolocationPositionError, freshRequest = false) => {
      if (request !== generation.current || freshRequest && problem.code !== 1) return;
      if (problem.code === 1) {
        clear(); bestFix.current = null; setFix(null); setTracking(false); setSeeking(false);
        setError('Localisation refusée. Autorisez le GPS ou placez un point.');
      } else if (!bestFix.current || locationIssue(bestFix.current, Date.now())) {
        clearDeadline(); setSeeking(false);
        setError(problem.code === 3 ? 'Le GPS met trop de temps. Réessayez.' : 'Votre position est indisponible. Réessayez.');
      }
      // Transient failures keep the watch alive so the same request can recover.
    };
    try {
      const watchId = gps.watchPosition(success, failure, GPS_OPTIONS);
      if (generation.current === request) watch.current = watchId;
      else gps.clearWatch(watchId);
      // Ask for a fresh fix too: phones may deliver a coarse network result to the watch first.
      if (generation.current === request && typeof gps.getCurrentPosition === 'function') {
        try { gps.getCurrentPosition(success, (problem) => failure(problem, true), GPS_OPTIONS); }
        catch { /* The watch still provides updates if a fresh request is unsupported. */ }
      }
    } catch {
      clear(); setTracking(false); setSeeking(false); setError('GPS indisponible. Placez votre départ sur la carte.');
    }
  }, [clear, clearDeadline]);
  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!tracking) return;
    const tick = () => setClock(Date.now());
    const timer = window.setInterval(tick, 5_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [tracking]);
  const issue = error ?? (fix ? locationIssue(fix, clock) : null);
  const usable = !!fix && !issue;
  const pending = tracking && seeking && !usable && !error;
  const refining = pending && !!fix && fix.accuracy > MAX_ROUTE_ACCURACY;
  return { fix, tracking, pending, refining, issue: pending ? null : issue, usable, start, stop };
}
