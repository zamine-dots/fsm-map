/** Editing is compiled out of production and is available only on a local dev address. */
declare const __FSM_LOCAL_EDITOR__: boolean;
export const isLoopbackHost = (hostname: string): boolean => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
export const mayEditCampus = (development: boolean, hostname: string): boolean => development && isLoopbackHost(hostname);
export const CAN_EDIT_CAMPUS = typeof __FSM_LOCAL_EDITOR__ !== 'undefined' && __FSM_LOCAL_EDITOR__ && typeof window !== 'undefined' && mayEditCampus(import.meta.env?.DEV === true, window.location.hostname);
export const LOCAL_ROOM_API = '/__local-campus/rooms';
