export type BuildingSide = 'front' | 'rear';

export interface CampusCorrection {
  name: string;
  aliases: string[];
  source: string;
  recordedAt: string;
  rooms: Record<string, { side: BuildingSide; entranceId: string }>;
}

export const CAMPUS_CORRECTIONS: Record<string, CampusCorrection> = {
  'way/1203834931': {
    name: 'Amphithéâtres 1–6',
    aliases: ['Bâtiment 27', 'Amphis 1 à 6', 'Amphis 1-6'],
    source: 'User identification: Amphis 1, 2, 3 face the front; Amphis 4, 5, 6 face the rear. Room outlines and entrance positions come from OpenStreetMap.',
    recordedAt: '2026-10-02',
    rooms: {
      'way/620055879': { side: 'front', entranceId: 'node/11151934117' },
      'way/620055880': { side: 'front', entranceId: 'node/11151934116' },
      'way/620055881': { side: 'front', entranceId: 'node/11151934115' },
      'way/620055882': { side: 'rear', entranceId: 'node/11151934121' },
      'way/620055883': { side: 'rear', entranceId: 'node/11151934120' },
      'way/620055884': { side: 'rear', entranceId: 'node/11151934119' },
    },
  },
};
