import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { isLoopbackHost, LOCAL_ROOM_API } from '../src/lib/campus-editing.ts';
import { prepareCampus, type CampusData } from '../src/lib/campus.ts';
import { parseRoomLocations, validateRoomLocationGeometry } from '../src/lib/room-locations-format.ts';

export function localRoomMiddleware(file: string, model: ReturnType<typeof prepareCampus>, secure = false) {
  let writes: Promise<unknown> = Promise.resolve();
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== LOCAL_ROOM_API) { next(); return; }
    const reply = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    const address = request.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
    let trusted = false;
    try {
      const origin = new URL(request.headers.origin ?? '');
      trusted = isLoopbackHost(address) && isLoopbackHost(origin.hostname) && origin.host === request.headers.host && origin.protocol === (secure ? 'https:' : 'http:');
    } catch { /* Requests without a same-origin local browser origin cannot write. */ }
    if (!trusted || request.headers['x-fsm-local-editor'] !== '1') { reply(403, { error: 'Édition disponible uniquement dans le développement local.' }); return; }
    if (request.method !== 'POST') { reply(405, { error: 'Utilisez le bouton Enregistrer dans le projet.' }); return; }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Le plan doit être envoyé en JSON.' }); return; }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > 1_048_576) { reply(413, { error: 'Le plan dépasse 1 Mo.' }); return; }
        chunks.push(buffer);
      }
      const data = parseRoomLocations(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      validateRoomLocationGeometry(data, model.campusBuildings);
      const operation = writes.then(async () => {
        const current = parseRoomLocations(JSON.parse(await readFile(file, 'utf8')));
        if (current.updatedAt !== data.updatedAt) return { conflict: true as const };
        const updatedAt = new Date(Math.max(Date.now(), current.updatedAt === null ? 0 : Date.parse(current.updatedAt) + 1)).toISOString();
        const temporary = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, JSON.stringify({ ...data, updatedAt }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); }
        finally { await unlink(temporary).catch(() => {}); }
        return { conflict: false as const, updatedAt };
      });
      writes = operation.catch(() => {});
      const result = await operation;
      if (result.conflict) { reply(409, { error: 'Le plan du projet a changé. Rechargez la page avant de l’enregistrer.' }); return; }
      reply(200, { saved: true, count: data.locations.length, updatedAt: result.updatedAt });
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Le plan n’a pas pu être enregistré.' }); }
  };
}

/** Vite development middleware only; no write endpoint is included in dist or Vercel. */
export function localCampusEditor(): Plugin {
  return { name: 'fsm-local-campus-editor', apply: 'serve', async configureServer(server) {
    const model = prepareCampus(JSON.parse(await readFile(resolve(server.config.root, 'public/data/campus.geojson'), 'utf8')) as CampusData);
    server.middlewares.use(localRoomMiddleware(resolve(server.config.root, 'src/data/room-locations.json'), model, Boolean(server.config.server.https)));
  } };
}
