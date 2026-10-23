/** Local owner editing and readonly production checks, using disposable storage and room fixtures. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, createServer, preview } from 'vite';

const TAGS = 'fsm-building-tags-v1';
const SCHEDULE = 'fsm-navigator-schedule-v1';
const PREFERENCES = 'fsm-navigator-preferences-v1';
const LEGACY = 'fsm-building-edits-v1';
const buildingId = 'way/1203834931';
const course = { id: 'map-test-course', buildingId, catalogCode: null, title: 'Analyse du plan', room: 'Amphi 1', floor: 1, label: '', days: [1], startTime: '09:00', endTime: '10:30' };
const tag = { id: 'map-test-tag', buildingId, label: 'Salle de test', floor: 0, point: [-44, 17], courseId: null };
const ROOM_API = '/__local-campus/rooms';
const roomFile = resolve('src/data/room-locations.json');
const roomSource = await readFile(roomFile, 'utf8');
const roomFixture = { format: 'fsm-room-locations', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', updatedAt: '2026-10-24T00:00:00.000Z', locations: [
  { id: 'fixture-room', buildingId, name: 'INF.301', floor: 0, point: [-44, 17] },
  { id: 'fixture-amphi-five', buildingId, name: 'A-5', floor: 1, point: [-44, 17] },
] };
const tagsBackup = (tags) => JSON.stringify({ format: 'fsm-building-tags', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', tags });
const scheduleBackup = (classes) => JSON.stringify({ format: 'fsm-navigator-schedule', version: 1, campusId: 'fsm-campus', timezone: 'Africa/Tunis', exportedAt: '2026-10-05T08:00:00.000Z', classes });
const cases = [];
const check = (name, run, options = {}) => { if (!process.env.FSM_CHECK_FILTER || name.includes(process.env.FSM_CHECK_FILTER)) cases.push({ name, run, options }); };
let base;
const mapPath = '/map?' + new URLSearchParams({ view: 'list', building: buildingId });
const plan = (page) => page.locator('.fsm-building-plan');
const visible = (locator) => locator.waitFor({ state: 'visible' });
const gone = (locator) => locator.waitFor({ state: 'hidden' });
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).tags, TAGS);
const raw = (page) => page.evaluate((key) => localStorage.getItem(key), TAGS);

async function seed(page, { tags = [], classes = [], original = tagsBackup(tags), legacy = '{}', path = mapPath } = {}) {
  await page.goto(base + '/settings');
  await page.evaluate(({ keys, original, schedule, legacy }) => {
    localStorage.setItem(keys.tags, original);
    localStorage.setItem(keys.schedule, schedule);
    localStorage.setItem(keys.preferences, JSON.stringify({ version: 1, state: { theme: 'light', lowPower: true, labels: true, mapMode: '3d' } }));
    localStorage.setItem(keys.legacy, legacy);
  }, { keys: { tags: TAGS, schedule: SCHEDULE, preferences: PREFERENCES, legacy: LEGACY }, original, legacy, schedule: scheduleBackup(classes) });
  await page.goto(base + path);
  await visible(plan(page).getByRole('group', { name: /^Plan 2D de/ }));
}

async function addTag(page, label, { room = 'Amphi 1', courseId, keyboard = false } = {}) {
  const section = plan(page);
  await section.getByRole('button', { name: 'Ajouter un tag', exact: true }).click();
  if (courseId !== undefined) await section.getByRole('combobox', { name: 'Cours associé', exact: true }).selectOption(courseId);
  await section.getByLabel('Nom du tag', { exact: true }).fill(label);
  if (keyboard) {
    const svg = section.getByRole('group', { name: /^Plan 2D de/ });
    await svg.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
  } else {
    await section.getByRole('combobox', { name: 'Placer dans une salle cartographiée', exact: true }).selectOption({ label: room });
  }
  await section.getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  await gone(section.locator('form'));
}

async function exportTags(page, name = 'Exporter les tags') {
  await plan(page).locator('details').evaluate((element) => { element.open = true; });
  const pending = page.waitForEvent('download');
  await plan(page).getByRole('button', { name, exact: true }).click();
  const result = await pending;
  const chunks = [];
  for await (const chunk of await result.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function importTags(page, value) {
  await plan(page).getByLabel('Sauvegarde des tags', { exact: true }).setInputFiles({ name: 'tags.json', mimeType: 'application/json', buffer: Buffer.from(value) });
}

async function noOverflow(page) {
  for (const selector of ['html', '.fsm-building-plan', '.nav-building-sheet-scroll']) {
    const element = page.locator(selector);
    if (await element.count()) assert(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), selector + ' overflows');
  }
}

check('tag creation, movement, floors, reload and confirmed deletion in the directory', async ({ page }) => {
  let models = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('.glb')) models++; });
  await seed(page);
  await addTag(page, 'TP de physique');
  const first = (await saved(page))[0];
  assert.equal(first.floor, 0);
  await page.reload();
  await plan(page).getByRole('button', { name: 'Éditer TP de physique', exact: true }).click();
  await plan(page).getByLabel('Nom du tag', { exact: true }).fill('TP déplacé');
  await plan(page).getByRole('combobox', { name: 'Placer dans une salle cartographiée', exact: true }).selectOption({ label: 'Amphi 2' });
  await plan(page).getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  assert.notDeepEqual((await saved(page))[0].point, first.point);
  await plan(page).getByRole('combobox', { name: 'Niveau', exact: true }).selectOption('1');
  await gone(plan(page).getByRole('button', { name: 'Éditer TP déplacé', exact: true }));
  await addTag(page, 'Cours à l’étage', { room: 'Amphi 3' });
  await plan(page).getByRole('combobox', { name: 'Niveau', exact: true }).selectOption('unknown');
  await addTag(page, 'Niveau à confirmer', { keyboard: true });
  assert.deepEqual((await saved(page)).map((entry) => entry.floor), [0, 1, null]);
  await plan(page).getByRole('button', { name: 'Supprimer le tag Niveau à confirmer', exact: true }).click();
  await plan(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal((await saved(page)).length, 3);
  await plan(page).getByRole('button', { name: 'Supprimer le tag Niveau à confirmer', exact: true }).click();
  await plan(page).getByRole('button', { name: 'Supprimer le tag', exact: true }).click();
  assert.equal((await saved(page)).length, 2);
  assert.equal(models, 0, 'the directory must not load a GLB');
  assert.equal(await page.locator('canvas').count(), 0);
});

check('touch and keyboard placement, escape, narrow screens and dark theme', async ({ page }) => {
  await seed(page);
  await plan(page).getByRole('button', { name: 'Ajouter un tag', exact: true }).click();
  await plan(page).getByLabel('Nom du tag', { exact: true }).fill('Tag tactile');
  const svg = plan(page).getByRole('group', { name: /^Plan 2D de/ });
  await svg.scrollIntoViewIfNeeded();
  let box = await svg.boundingBox();
  await page.touchscreen.tap(box.x + 2, box.y + 2);
  await visible(plan(page).getByText(/Placez le tag à l’intérieur/));
  await svg.scrollIntoViewIfNeeded();
  box = await svg.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await plan(page).getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  assert.equal((await saved(page))[0].label, 'Tag tactile');
  await plan(page).getByRole('button', { name: 'Éditer Tag tactile', exact: true }).click();
  await page.keyboard.press('Escape');
  await gone(plan(page).locator('form'));
  await visible(page.locator('.nav-building-sheet'));
  await noOverflow(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow(page);
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await page.getByRole('radio', { name: 'Sombre', exact: true }).check();
  await page.goto(base + mapPath);
  await visible(plan(page).getByRole('button', { name: 'Éditer Tag tactile', exact: true }));
  assert.equal(await page.locator('.navigator-shell').getAttribute('data-theme'), 'dark');
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await noOverflow(page);
}, { viewport: { width: 390, height: 844 }, hasTouch: true });

check('personal class links preselect floor and survive removal of the course', async ({ page }) => {
  await seed(page, { classes: [course], path: mapPath + '&class=' + course.id });
  assert.equal(await plan(page).getByRole('combobox', { name: 'Niveau', exact: true }).inputValue(), '1');
  await addTag(page, 'Analyse · Amphi 1');
  assert.equal((await saved(page))[0].courseId, course.id);
  assert.equal((await saved(page))[0].floor, 1);
  await visible(plan(page).locator('g[data-course-selected="true"]'));
  await plan(page).getByRole('link', { name: 'Voir ce cours dans le planning', exact: true }).click();
  await visible(page.getByRole('dialog', { name: 'Modifier le cours', exact: true }));
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer Analyse du plan', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer le cours', exact: true }).click();
  await page.goto(base + mapPath);
  await plan(page).getByRole('combobox', { name: 'Niveau', exact: true }).selectOption('1');
  await visible(plan(page).getByText('Cours associé indisponible · le tag est conservé', { exact: true }));
  await plan(page).getByRole('button', { name: 'Éditer Analyse · Amphi 1', exact: true }).click();
  await plan(page).getByRole('combobox', { name: 'Cours associé', exact: true }).selectOption('');
  await plan(page).getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  assert.equal((await saved(page))[0].courseId, null);
});

check('tag backups validate and require confirmation without changing the schedule', async ({ page }) => {
  await seed(page, { tags: [tag], classes: [course] });
  const retained = await page.evaluate(([schedule, legacy]) => [localStorage.getItem(schedule), localStorage.getItem(legacy)], [SCHEDULE, LEGACY]);
  const exported = await exportTags(page);
  assert.deepEqual(JSON.parse(exported).tags, [tag]);
  const original = await raw(page);
  await importTags(page, tagsBackup([]));
  await visible(plan(page).getByRole('button', { name: 'Remplacer tous les tags', exact: true }));
  await plan(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await raw(page), original);
  await importTags(page, scheduleBackup([course]));
  await visible(plan(page).getByText('Format de sauvegarde des tags non reconnu.', { exact: true }));
  assert.equal(await raw(page), original);
  await importTags(page, '{broken');
  await visible(plan(page).locator('.fsm-plan-error'));
  assert.equal(await raw(page), original);
  await importTags(page, tagsBackup([]));
  await plan(page).getByRole('button', { name: 'Remplacer tous les tags', exact: true }).click();
  assert.deepEqual(await saved(page), []);
  await importTags(page, exported);
  await plan(page).getByRole('button', { name: 'Remplacer tous les tags', exact: true }).click();
  assert.deepEqual(await saved(page), [tag]);
  assert.deepEqual(await page.evaluate(([schedule, legacy]) => [localStorage.getItem(schedule), localStorage.getItem(legacy)], [SCHEDULE, LEGACY]), retained);
});

check('corrupt tag storage is retained and failed writes remain recoverable', async ({ page }) => {
  const original = '{original tags';
  await seed(page, { original });
  await addTag(page, 'Tag récupéré');
  assert.equal(await raw(page), original);
  assert.equal(await exportTags(page, 'Télécharger la copie originale'), original);
  assert.equal(JSON.parse(await exportTags(page)).tags[0].label, 'Tag récupéré');
  await plan(page).getByRole('button', { name: 'Remplacer la copie locale', exact: true }).click();
  await plan(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await raw(page), original);
  await plan(page).getByRole('button', { name: 'Remplacer la copie locale', exact: true }).click();
  await plan(page).getByRole('button', { name: 'Confirmer le remplacement', exact: true }).click();
  const retained = await raw(page);
  await page.evaluate((key) => {
    window.__fsmDenyTagWrites = true;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && window.__fsmDenyTagWrites) throw new DOMException('Full', 'QuotaExceededError');
      return write.call(this, name, value);
    };
  }, TAGS);
  await addTag(page, 'Tag en mémoire');
  await visible(plan(page).getByText(/Les tags ne peuvent pas être enregistrés/));
  assert.equal(await raw(page), retained);
  assert.equal(JSON.parse(await exportTags(page)).tags.length, 2);
  await page.evaluate(() => { window.__fsmDenyTagWrites = false; });
  await plan(page).getByRole('button', { name: 'Réessayer l’enregistrement', exact: true }).click();
  assert.equal((await saved(page)).length, 2);
});

check('cross-tab tag edits synchronize and stale forms cannot overwrite a newer tag', async ({ page, context }) => {
  await seed(page, { tags: [tag] });
  await plan(page).getByRole('button', { name: 'Éditer Salle de test', exact: true }).click();
  const other = await context.newPage();
  await other.goto(base + mapPath);
  await plan(other).getByRole('button', { name: 'Éditer Salle de test', exact: true }).click();
  await plan(other).getByLabel('Nom du tag', { exact: true }).fill('Autre onglet');
  await plan(other).getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  await visible(plan(page).getByRole('button', { name: 'Éditer Autre onglet', exact: true }));
  await plan(page).getByLabel('Nom du tag', { exact: true }).fill('Ancienne copie');
  await plan(page).getByRole('button', { name: 'Enregistrer le tag', exact: true }).click();
  await visible(plan(page).getByText(/Ce tag a changé dans un autre onglet/));
  assert.equal((await saved(page))[0].label, 'Autre onglet');
  await plan(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  await other.close();
});

check('the original explorer shares tags and displays terracotta courtyard paving without WebGL', async ({ page }) => {
  await seed(page, { tags: [tag] });
  await page.getByRole('link', { name: 'Voir dans le plan détaillé', exact: true }).click();
  await visible(plan(page).getByRole('button', { name: 'Éditer Salle de test', exact: true }));
  const courtyard = page.locator('.fallback-map path[data-landmark-id="node/7228004560"]');
  await visible(courtyard);
  assert.equal(await courtyard.getAttribute('fill'), '#d9a392');
  await visible(page.getByRole('img', { name: 'Cour Rouge · Cour extérieure', exact: true }));
  assert(await page.locator('.fallback-map [data-courtyard-paving]').count());
  assert.equal((await courtyard.getAttribute('d')).match(/M/g).length, 4, 'courtyard and three garden holes');
  await addTag(page, 'Tag du plan détaillé', { room: 'Amphi 2' });
  await page.getByRole('button', { name: 'Volume 3D', exact: true }).click();
  await visible(page.getByRole('img', { name: 'Volume de Amphithéâtres 1–6', exact: true }));
  await page.getByRole('button', { name: 'Plan 2D & tags', exact: true }).click();
  await visible(plan(page).getByRole('button', { name: 'Éditer Tag du plan détaillé', exact: true }));
  await page.goto(base + mapPath);
  await visible(plan(page).getByRole('button', { name: 'Éditer Tag du plan détaillé', exact: true }));
});

check('Cour Rouge focuses in 3D and 2D, including links from the building directory', async ({ page }) => {
  await seed(page, { classes: [course] });
  await plan(page).getByRole('button', { name: 'Voir Cour Rouge sur la carte', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('landmark'), 'cour-rouge');
  assert.equal(new URL(page.url()).searchParams.has('view'), false);
  assert.equal(new URL(page.url()).searchParams.has('building'), false);
  await visible(page.locator('.nav-canvas-host[data-state="ready"]'));
  await gone(page.locator('.nav-building-sheet'));
  const centered = async () => page.waitForFunction(() => {
    const label = document.querySelector('.nav-cour-label')?.getBoundingClientRect();
    const canvas = document.querySelector('canvas')?.getBoundingClientRect();
    return label && canvas && Math.abs(label.x + label.width / 2 - canvas.x - canvas.width / 2) < 40 && Math.abs(label.y + label.height / 2 - canvas.y - canvas.height / 2) < 40;
  });
  await centered();
  await visible(page.getByRole('region', { name: 'Cour Rouge', exact: true }));
  assert.equal(await page.locator('.nav-cour-label').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(246, 231, 219)');
  await page.screenshot({ path: 'test-results/map/cour-rouge-3d.png' });
  await page.getByRole('button', { name: 'Afficher en 2D', exact: true }).click();
  await visible(page.getByRole('button', { name: 'Afficher en 3D', exact: true }));
  await page.getByRole('button', { name: 'Options de la carte', exact: true }).click();
  await page.waitForFunction(() => {
    const north = document.querySelector('.nav-north svg');
    return north && getComputedStyle(north).transform === 'matrix(1, 0, 0, 1, 0, 0)';
  });
  await page.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
  await centered();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'test-results/map/cour-rouge-2d.png' });
  await page.reload();
  await visible(page.locator('.nav-canvas-host[data-state="ready"]'));
  await centered();
  // A direct tap on the 3D label must clear an existing class, just like the toolbar.
  await page.goto(base + '/map?' + new URLSearchParams({ building: buildingId, class: course.id }));
  await visible(page.locator('.nav-canvas-host[data-state="ready"]'));
  await visible(page.getByRole('region', { name: 'Amphithéâtres 1–6', exact: true }));
  await page.locator('.nav-cour-label').click();
  await visible(page.getByRole('region', { name: 'Cour Rouge', exact: true }));
  await gone(page.locator('.nav-building-sheet'));
  assert.equal(new URL(page.url()).searchParams.has('building'), false);
  assert.equal(new URL(page.url()).searchParams.has('class'), false);
  assert.equal(await page.locator('.nav-courtyard-card').getByText(/étage|salle de cours|Amphi/i).count(), 0);
  await centered();
  await page.goto(base + mapPath);
  await addTag(page, 'TP dans l’amphi', { room: 'Amphi 2', courseId: course.id });
  await plan(page).getByRole('button', { name: 'Éditer TP dans l’amphi', exact: true }).click();
  await plan(page).locator('form').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/map/building-tags.png' });
}, { webgl: true });

check('Cour Rouge search opens a courtyard landmark and can start a walking route', async ({ page }) => {
  await seed(page, { classes: [course] });
  const search = page.getByRole('searchbox', { name: 'Rechercher un bâtiment, une salle ou un cours', exact: true });
  await search.fill('Cour Rouge');
  await visible(page.locator('.nav-building-option[data-place-kind="courtyard"]'));
  await search.press('Enter');
  const card = page.getByRole('region', { name: 'Cour Rouge', exact: true });
  await visible(card);
  await gone(page.locator('.nav-building-sheet'));
  await card.getByRole('link', { name: 'Partir d’ici', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Où allez-vous ?', exact: true }));
  assert.equal(new URL(page.url()).searchParams.get('from'), 'cour-rouge');
  assert.equal(new URL(page.url()).searchParams.has('destination'), false, 'the courtyard must not become the classroom destination');
  await page.getByRole('combobox', { name: 'Rechercher une salle ou un cours', exact: true }).fill('Amphi 2');
  await page.getByRole('option', { name: /^Amphi 2 / }).click();
  await visible(page.getByTestId('route-summary'));
  assert.match(await page.getByTestId('route-summary').innerText(), /69 m/);
  await visible(page.getByTestId('position-3d'));
}, { webgl: true });

check('local project saves export every floor without personal courses and retain drafts on failure', async ({ page }) => {
  const pins = [{ ...tag, courseId: course.id }, { ...tag, id: 'map-test-upstairs', label: 'Salle à l’étage', floor: 1 }];
  const requests = [];
  const revisions = ['2026-10-24T01:00:00.000Z', '2026-10-24T01:00:01.000Z'];
  await page.route('**' + ROOM_API, async (route) => {
    const request = route.request();
    assert.equal(request.method(), 'POST');
    assert.equal(request.headers()['x-fsm-local-editor'], '1');
    requests.push(request.postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 150));
    const conflict = requests.length === 2;
    await route.fulfill({ status: conflict ? 409 : 200, contentType: 'application/json', body: JSON.stringify(conflict
      ? { error: 'Le plan du projet a changé. Rechargez la page avant de l’enregistrer.' }
      : { saved: true, count: pins.length, updatedAt: revisions[requests.length === 1 ? 0 : 1] }) });
  });
  await seed(page, { tags: pins, classes: [course] });
  const denied = await page.request.post(base + ROOM_API, { headers: { Origin: 'https://external.example', 'X-FSM-Local-Editor': '1' }, data: {} });
  assert.equal(denied.status(), 403, 'the real local endpoint must reject a foreign origin without writing');
  assert.match((await denied.json()).error, /uniquement dans le développement local/);
  assert.equal(await plan(page).getAttribute('data-editable'), 'true');
  const button = plan(page).getByRole('button', { name: 'Enregistrer dans le projet', exact: true });
  await plan(page).getByRole('button', { name: 'Ajouter un tag', exact: true }).click();
  assert(await button.isDisabled(), 'an unfinished placement cannot be published');
  await plan(page).getByRole('button', { name: 'Annuler l’édition du tag', exact: true }).click();
  const retained = await page.evaluate((key) => localStorage.getItem(key), SCHEDULE);
  await button.click();
  assert(await plan(page).getByRole('button', { name: 'Enregistrement…', exact: true }).isDisabled());
  await visible(plan(page).getByText('Salles enregistrées dans le projet. Elles seront partagées au prochain déploiement.', { exact: true }));
  assert.deepEqual(requests[0].locations, pins.map(({ id, buildingId, label, floor, point }) => ({ id, buildingId, name: label, floor, point })));
  assert.equal(requests[0].updatedAt, JSON.parse(roomSource).updatedAt);
  assert.equal(JSON.stringify(requests[0]).includes(course.id), false);
  await button.click();
  await visible(plan(page).getByText(/Le plan du projet a changé/));
  assert.equal(requests[1].updatedAt, revisions[0]);
  assert.deepEqual(await saved(page), pins, 'a failed project save keeps the local draft');
  await button.click();
  await visible(plan(page).getByText('Salles enregistrées dans le projet. Elles seront partagées au prochain déploiement.', { exact: true }));
  assert.equal(requests[2].updatedAt, revisions[0]);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), SCHEDULE), retained);
  await noOverflow(page);
}, { viewport: { width: 320, height: 568 } });

async function assertReadonly(page) {
  assert.equal(await plan(page).getAttribute('data-editable'), 'false');
  assert.equal(await plan(page).getByRole('button', { name: /Ajouter un tag|Éditer |Modifier le tag|Supprimer le tag|Importer les tags|Exporter les tags|Enregistrer dans le projet|Remplacer la copie locale/ }).count(), 0);
  assert.equal(await plan(page).locator('form, input[type="file"], .fsm-plan-backup').count(), 0);
  await visible(plan(page).getByRole('heading', { name: 'Plan des salles', exact: true }));
}

check('production hides room editors and building corrections even with old browser edits', async ({ page }) => {
  const legacy = JSON.stringify({ [buildingId]: { name: 'Visitor modified building', levels: 11 } });
  await seed(page, { tags: [tag], classes: [course], legacy, path: mapPath + '&edit=1' });
  await assertReadonly(page);
  assert.equal(await plan(page).locator('[data-tag-id="map-test-tag"]').count(), 0);
  assert.equal(await raw(page), tagsBackup([tag]));
  await noOverflow(page);
  await page.goto(base + '/explore?' + new URLSearchParams({ building: buildingId, edit: '1' }));
  await visible(page.getByRole('heading', { name: 'Amphithéâtres 1–6', exact: true }));
  await visible(plan(page).getByRole('group', { name: /^Plan 2D de/ }));
  await assertReadonly(page);
  assert.equal(await page.getByRole('button', { name: /Ajuster les détails|Enregistrer la correction/ }).count(), 0);
  assert.equal(await page.getByText('Visitor modified building', { exact: true }).count(), 0);
  assert.equal(await plan(page).locator('[data-tag-id="map-test-tag"]').count(), 0);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), LEGACY), legacy);
  await page.evaluate((key) => localStorage.setItem(key, '{corrupt old pins'), TAGS);
  await page.reload();
  await visible(plan(page).getByRole('group', { name: /^Plan 2D de/ }));
  await assertReadonly(page);
  assert.equal(await plan(page).getByRole('alert').count(), 0);
  assert.equal(await raw(page), '{corrupt old pins');
  const response = await page.evaluate(async (path) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FSM-Local-Editor': '1' }, body: '{}' });
    return response.status;
  }, ROOM_API);
  assert.equal(response, 404, 'a production preview cannot expose the local write endpoint');
}, { mode: 'production', viewport: { width: 390, height: 844 } });

check('published room locations stay fixed on phones and appear in search, routes and both plans', async ({ page }) => {
  const oldPins = [{ ...tag, id: 'fixture-room', label: 'Visitor changed room', point: [-45, 18] }];
  await seed(page, { tags: oldPins });
  await assertReadonly(page);
  const pin = plan(page).locator('g[data-tag-id="fixture-room"]');
  assert.equal(await pin.getAttribute('role'), 'img');
  assert.equal(await pin.getAttribute('tabindex'), null);
  assert.equal(await pin.getAttribute('aria-label'), 'INF.301');
  assert.equal(await pin.locator('.fsm-plan-pin-dot').getAttribute('cx'), '-44');
  await pin.locator('.fsm-plan-pin-dot').scrollIntoViewIfNeeded();
  const dot = await pin.locator('.fsm-plan-pin-dot').boundingBox();
  assert(dot);
  await page.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2);
  const svg = plan(page).getByRole('group', { name: /^Plan 2D de/ });
  await svg.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await plan(page).locator('form').count(), 0);
  assert.equal(await pin.locator('.fsm-plan-pin-dot').getAttribute('cx'), '-44');
  assert.equal(await raw(page), tagsBackup(oldPins));
  const link = plan(page).getByRole('link', { name: 'Y aller', exact: true });
  assert.match(await link.getAttribute('href'), /destination=location%3Afixture-room/);
  await noOverflow(page);
  await page.goto(base + '/map?navigate=1');
  const search = page.getByRole('combobox', { name: 'Rechercher une salle ou un cours', exact: true });
  await search.fill('INF301');
  await page.getByRole('option', { name: /^INF\.301 / }).click();
  await page.getByRole('button', { name: /^Cour Rouge Cour extérieure$/ }).click();
  await visible(page.getByTestId('route-summary'));
  await page.getByRole('button', { name: 'Étapes', exact: true }).click();
  const arrival = page.locator('.route-arrival-tag');
  await visible(arrival);
  assert.equal(await arrival.getAttribute('cx'), '-44');
  assert.equal(await arrival.getAttribute('cy'), '17');
  await page.getByRole('link', { name: 'Ouvrir le plan du bâtiment', exact: true }).click();
  await visible(plan(page).getByRole('group', { name: /^Plan 2D de/ }));
  await plan(page).getByRole('combobox', { name: 'Niveau', exact: true }).selectOption('1');
  await visible(plan(page).getByRole('img', { name: 'A-5', exact: true }));
  assert.match(await plan(page).getByRole('link', { name: 'Y aller', exact: true }).getAttribute('href'), /destination=room%3Away/);
  await page.goto(base + '/explore?' + new URLSearchParams({ building: buildingId }));
  await visible(plan(page).getByRole('img', { name: 'INF.301', exact: true }));
  await assertReadonly(page);
  assert.equal(await plan(page).locator('.fsm-plan-pin-dot').getAttribute('cx'), '-44');
  await page.screenshot({ path: 'test-results/map/phone-readonly-rooms.png' });
}, { mode: 'fixture', viewport: { width: 390, height: 844 }, hasTouch: true });

let devServer;
let productionServer;
let fixtureServer;
let fixtureDirectory;
let browser;
let failures = 0;
try {
  await mkdir('test-results/map', { recursive: true });
  const bases = {};
  const serverBase = (server) => {
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string');
    return 'http://127.0.0.1:' + address.port;
  };
  if (cases.some(({ options }) => !options.mode || options.mode === 'dev')) {
    devServer = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    await devServer.listen();
    bases.dev = serverBase(devServer);
  }
  if (cases.some(({ options }) => options.mode === 'production')) {
    productionServer = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    bases.production = serverBase(productionServer);
  }
  if (cases.some(({ options }) => options.mode === 'fixture')) {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'fsm-published-room-browser-'));
    // Vite's APIs share NODE_ENV; compile the fixture with production React after starting local dev.
    const fixtureEnvironment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await build({ mode: 'production', logLevel: 'error', build: { outDir: fixtureDirectory, emptyOutDir: true }, plugins: [{
        name: 'fsm-published-room-test-fixture', enforce: 'pre',
        load(id) { if (id.split('?')[0] === roomFile) return JSON.stringify(roomFixture); },
      }] });
    } finally {
      if (fixtureEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = fixtureEnvironment;
    }
    fixtureServer = await preview({ logLevel: 'error', build: { outDir: fixtureDirectory }, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    bases.fixture = serverBase(fixtureServer);
  }
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  for (const { name, run, options: { mode = 'dev', webgl = false, ...options } } of cases) {
    base = bases[mode];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
    // Keep the suite hermetic without breaking the explorer stylesheet, which @imports Google Fonts.
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (mode === 'dev' && url.pathname === ROOM_API) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Browser fixtures cannot edit the source room file.' }) });
      if (url.origin === base) return route.continue();
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return route.abort();
    });
    if (!webgl) await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...args); };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await run({ page, context });
      assert.deepEqual(errors, [], 'uncaught browser errors');
      console.log('PASS ' + name);
    } catch (error) {
      failures++;
      console.error('FAIL ' + name + '\n' + (error.stack ?? error));
      const artifact = 'test-results/map/' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await page.screenshot({ path: artifact + '.png', fullPage: true }).catch(() => {});
      await writeFile(artifact + '.txt', await page.locator('body').innerText()).catch(() => {});
    } finally { await context.close(); }
  }
  console.log((cases.length - failures) + '/' + cases.length + ' map browser checks passed.');
  assert.equal(await readFile(roomFile, 'utf8'), roomSource, 'browser fixtures must never change the real room locations');
  if (!cases.length || failures) process.exitCode = 1;
} finally {
  await browser?.close();
  await devServer?.close();
  for (const server of [productionServer, fixtureServer]) if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
}
