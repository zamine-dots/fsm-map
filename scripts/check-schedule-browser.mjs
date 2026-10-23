/** Production acceptance checks. Run npm run build first; every test uses disposable browser storage. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const KEY = 'fsm-navigator-schedule-v1';
const PREFERENCES = 'fsm-navigator-preferences-v1';
const LEGACY = 'fsm-building-edits-v1';
const buildingId = 'way/1203834931';
const fixture = {
  id: 'acceptance-course', buildingId, catalogCode: null, title: 'Analyse de test',
  room: 'Amphi 1', floor: null, label: '', days: [1, 3], startTime: '09:00', endTime: '10:30',
};
const envelope = (classes) => JSON.stringify({
  format: 'fsm-navigator-schedule', version: 1, campusId: 'fsm-campus',
  timezone: 'Africa/Tunis', exportedAt: '2026-10-05T08:00:00.000Z', classes,
});
const filter = process.env.FSM_CHECK_FILTER;
const cases = [];
const check = (name, run) => { if (!filter || name.includes(filter)) cases.push({ name, run }); };
let base;

async function seed(page, classes = [], raw = envelope(classes)) {
  await page.goto(base + '/settings');
  await page.evaluate(({ key, raw, preferences, legacy }) => {
    localStorage.setItem(key, raw);
    localStorage.setItem(preferences, JSON.stringify({ version: 1, state: { theme: 'light', lowPower: true, labels: true, mapMode: '3d' } }));
    localStorage.setItem(legacy, '{}');
  }, { key: KEY, raw, preferences: PREFERENCES, legacy: LEGACY });
  await page.goto(`${base}/schedule`);
}
const rawCopy = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const savedClasses = async (page) => JSON.parse(await rawCopy(page)).classes;
async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
async function gone(locator) { await locator.waitFor({ state: 'hidden' }); }
const backupDialog = (page) => page.getByRole('dialog', { name: 'Options du planning', exact: true });
async function openBackup(page) {
  if (!await backupDialog(page).isVisible()) await page.getByRole('link', { name: 'Options du planning', exact: true }).click();
}
async function closeBackup(page) {
  await backupDialog(page).getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
  await gone(backupDialog(page));
}
async function extraDetails(form) {
  if (!await form.locator('.nav-schedule-extra').evaluate((element) => element.open)) await form.locator('summary').click();
}
async function saveEdit(page) {
  const form = page.getByRole('dialog', { name: 'Modifier le cours', exact: true });
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
}

async function addClass(page, title = 'Cours ajouté', overrides = {}) {
  await page.getByRole('link', { name: 'Ajouter un cours', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Ajouter un cours', exact: true });
  await form.getByLabel(/^Bâtiment/).selectOption(buildingId);
  await form.getByLabel(/^Intitulé du cours/).fill(title);
  await form.getByLabel(/^Salle/).fill(overrides.room ?? 'Amphi 2');
  if (overrides.floor !== undefined) {
    await extraDetails(form);
    await form.getByLabel(/^Niveau/).fill(String(overrides.floor));
  }
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await form.getByLabel('Lundi', { exact: true }).check();
  await form.getByLabel('Mercredi', { exact: true }).check();
  await form.getByLabel(/^Début/).fill(overrides.startTime ?? '11:00');
  await form.getByLabel(/^Fin/).fill(overrides.endTime ?? '12:00');
  await form.getByRole('button', { name: 'Ajouter au planning', exact: true }).click();
  await gone(form);
}

async function importFile(page, raw, name = 'planning.json') {
  await openBackup(page);
  await page.getByLabel('Fichier de sauvegarde du planning').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(raw) });
}

async function download(page, button) {
  await openBackup(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await pending;
  const chunks = [];
  for await (const chunk of await result.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function denyStorage(page, mode) {
  await page.evaluate(({ key, mode }) => {
    window.__fsmStorageFailure = mode;
    if (window.__fsmStorageHook) return;
    window.__fsmStorageHook = true;
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === key && window.__fsmStorageFailure === 'read') throw new DOMException('Access denied', 'SecurityError');
      return read.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key && window.__fsmStorageFailure) throw new DOMException('Storage full', 'QuotaExceededError');
      return write.call(this, name, value);
    };
  }, { key: KEY, mode });
}

async function noOverflow(page, selector = 'html') {
  assert(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${selector} overflows horizontally`);
}

check('create, edit, reload, overlaps, weekly recurrence and confirmed deletion', async ({ page }) => {
  await seed(page);
  await visible(page.getByText('Ajoutez votre premier cours', { exact: true }));
  assert.equal(await page.getByRole('button', { name: 'Exporter le planning', exact: true }).count(), 0);
  await addClass(page);
  let classes = await savedClasses(page);
  assert.equal(classes.length, 1);
  assert.deepEqual(classes[0].days, [1, 3]);
  assert.equal(classes[0].floor, null);
  await page.reload();
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  assert.equal(await page.locator('.nav-timetable-day').count(), 7);
  assert.equal(await page.locator('.nav-session-card').count(), 2);
  await page.getByRole('link', { name: 'Modifier Cours ajouté', exact: true }).first().click();
  const form = page.getByRole('dialog');
  await extraDetails(form);
  await form.getByLabel(/^Libellé personnel/).fill('TD modifié');
  await form.getByLabel(/^Niveau/).fill('0');
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await form.getByLabel(/^Début/).fill('11:15');
  await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await gone(form);
  classes = await savedClasses(page);
  assert.equal(classes[0].floor, 0);
  assert.equal(classes[0].startTime, '11:15');
  assert.equal(classes[0].label, 'TD modifié');
  await addClass(page, 'Cours en conflit', { startTime: '11:30', endTime: '12:30' });
  await visible(page.getByText('Horaire en chevauchement').first());
  await page.getByRole('button', { name: 'Supprimer Cours en conflit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal((await savedClasses(page)).length, 2);
  await page.getByRole('button', { name: 'Supprimer Cours en conflit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Supprimer le cours', exact: true }).click();
  assert.equal((await savedClasses(page)).length, 1);
  assert.equal((await savedClasses(page))[0].label, 'TD modifié');
});

check('three tabs, old Maintenant links, campus clock and live Planning updates', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T07:59:00Z') });
  await page.clock.pauseAt(new Date('2026-10-05T07:59:01Z'));
  await seed(page, [{ ...fixture, days: [1] }, { ...fixture, id: 'overlap', title: 'Cours simultané', days: [1] }]);
  await page.goto(base + '/today');
  await page.waitForURL('**/schedule');
  assert.equal(await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link').count(), 3);
  assert.equal(await page.getByRole('link', { name: 'Maintenant', exact: true }).count(), 0);
  await visible(page.getByRole('button', { name: /^Lundi,/, pressed: true }));
  assert.equal(await page.locator('.nav-session-card.is-current').count(), 0);
  await page.clock.runFor(59_100);
  await visible(page.getByText('En cours', { exact: true }).first());
  assert.equal(await page.locator('.nav-session-card.is-current').count(), 2);
  assert.equal(await page.getByText('Horaire en chevauchement', { exact: true }).count(), 2);
  await visible(page.getByText('Cours simultané', { exact: true }));
  await page.clock.fastForward(90 * 60_000);
  await gone(page.getByText('En cours', { exact: true }));
  await page.clock.setSystemTime(new Date('2026-10-04T22:59:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(page.getByRole('button', { name: /^Dimanche,/, pressed: true }));
  await page.clock.runFor(60_100);
  await visible(page.getByRole('button', { name: /^Lundi,/, pressed: true }));
});

check('backup export, cancelled import, invalid import and unknown-building recovery', async ({ page }) => {
  await seed(page, [fixture]);
  const original = await rawCopy(page);
  const exported = await download(page, 'Exporter le planning');
  assert.deepEqual(JSON.parse(exported).classes, [fixture]);
  await importFile(page, envelope([]));
  await visible(page.getByRole('dialog', { name: 'Remplacer votre planning ?' }));
  await page.keyboard.press('Escape');
  await visible(backupDialog(page));
  await gone(page.getByRole('dialog', { name: 'Remplacer votre planning ?' }));
  assert.equal(await rawCopy(page), original);
  await importFile(page, '{broken');
  await visible(page.getByText(/Aucun cours n’a été modifié/));
  assert.equal(await rawCopy(page), original);
  await importFile(page, envelope([]).replace('fsm-campus', 'wrong-campus'));
  await visible(page.getByText(/autre campus ou fuseau/));
  assert.equal(await rawCopy(page), original);
  await importFile(page, envelope([{ ...fixture, buildingId: 'former-building' }]));
  await visible(page.getByText(/Certains bâtiments ne figurent plus/));
  await page.getByRole('button', { name: 'Remplacer le planning', exact: true }).click();
  await closeBackup(page);
  await page.getByRole('button', { name: /^Lundi,/ }).click();
  await visible(page.getByText('Bâtiment à corriger', { exact: true }));
  assert.equal(await page.locator('.nav-session-main[href]').count(), 0);
  assert.equal((await savedClasses(page))[0].buildingId, 'former-building');
  await importFile(page, exported);
  await page.getByRole('button', { name: 'Remplacer le planning', exact: true }).click();
  assert.deepEqual(await savedClasses(page), [fixture]);
  const retained = await page.evaluate(([preferences, legacy]) => [localStorage.getItem(preferences), localStorage.getItem(legacy)], [PREFERENCES, LEGACY]);
  await page.getByRole('button', { name: 'Effacer le planning', exact: true }).click();
  await page.getByRole('button', { name: 'Tout effacer', exact: true }).click();
  assert.deepEqual(await savedClasses(page), []);
  assert.deepEqual(await page.evaluate(([preferences, legacy]) => [localStorage.getItem(preferences), localStorage.getItem(legacy)], [PREFERENCES, LEGACY]), retained);
});

check('corrupt storage stays intact until recovery is explicitly confirmed', async ({ page }) => {
  const corrupt = '{original unreadable schedule';
  await seed(page, [], corrupt);
  await visible(page.getByText('La copie locale du planning est illisible.'));
  assert.equal(await rawCopy(page), corrupt);
  await addClass(page, 'Cours récupéré');
  assert.equal(await rawCopy(page), corrupt);
  assert.equal(await download(page, 'Télécharger la copie originale'), corrupt);
  assert.equal(JSON.parse(await download(page, 'Exporter le planning')).classes[0].title, 'Cours récupéré');
  await page.getByRole('button', { name: 'Enregistrer ce planning à la place', exact: true }).click();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await rawCopy(page), corrupt);
  await page.getByRole('button', { name: 'Enregistrer ce planning à la place', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer à la place', exact: true }).click();
  assert.equal((await savedClasses(page))[0].title, 'Cours récupéré');
  await closeBackup(page);
  await gone(page.getByText('La copie locale du planning est illisible.'));
});

for (const mode of ['read', 'write']) check(`${mode === 'read' ? 'denied' : 'quota-limited'} storage retains in-memory edits and allows retry`, async ({ page }) => {
  await seed(page);
  await denyStorage(page, mode);
  await addClass(page, 'Cours en mémoire');
  await visible(page.getByText('Le planning ne peut pas être enregistré ici.'));
  assert.equal(JSON.parse(await download(page, 'Exporter le planning')).classes[0].title, 'Cours en mémoire');
  await denyStorage(page, null);
  assert.deepEqual(await savedClasses(page), []);
  await page.getByRole('button', { name: 'Réessayer l’enregistrement', exact: true }).click();
  await closeBackup(page);
  await gone(page.getByText('Le planning ne peut pas être enregistré ici.'));
  assert.equal((await savedClasses(page))[0].title, 'Cours en mémoire');
});

check('cross-tab synchronization, stale edit rejection and unsaved conflict recovery', async ({ page, context }) => {
  await seed(page, [fixture]);
  await page.getByRole('button', { name: /^Lundi,/ }).click();
  await page.getByRole('link', { name: `Modifier ${fixture.title}`, exact: true }).click();
  const other = await context.newPage();
  await other.goto(`${base}/schedule`);
  await other.getByRole('button', { name: /^Lundi,/ }).click();
  await other.getByRole('link', { name: `Modifier ${fixture.title}`, exact: true }).click();
  await extraDetails(other.getByRole('dialog'));
  await other.getByLabel(/^Libellé personnel/).fill('Autre onglet');
  await saveEdit(other);
  await saveEdit(page);
  await visible(page.getByText(/Ce cours a changé dans un autre onglet/));
  await page.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
  await visible(page.getByRole('link', { name: 'Modifier Autre onglet', exact: true }));
  await denyStorage(page, 'write');
  await addClass(page, 'Cours non enregistré');
  await other.getByRole('link', { name: 'Modifier Autre onglet', exact: true }).click();
  await other.getByLabel(/^Libellé personnel/).fill('Dernière copie');
  await saveEdit(other);
  await visible(page.getByText('Un autre onglet a modifié votre planning.'));
  await visible(page.getByRole('link', { name: 'Modifier Cours non enregistré', exact: true }));
  await denyStorage(page, null);
  await openBackup(page);
  await page.getByRole('button', { name: 'Recharger la copie enregistrée', exact: true }).click();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await closeBackup(page);
  await visible(page.getByRole('link', { name: 'Modifier Cours non enregistré', exact: true }));
  await openBackup(page);
  await page.getByRole('button', { name: 'Recharger la copie enregistrée', exact: true }).click();
  await page.getByRole('button', { name: 'Recharger le planning', exact: true }).click();
  await closeBackup(page);
  await visible(page.getByRole('link', { name: 'Modifier Dernière copie', exact: true }));
  await gone(page.getByRole('link', { name: 'Modifier Cours non enregistré', exact: true }));
});

for (const width of [320, 390, 1440]) check(`${width}px layout, weekly view, dialog keyboard focus and theme`, async ({ page }) => {
  const height = width === 320 ? 568 : width === 390 ? 844 : 900;
  await page.setViewportSize({ width, height });
  await seed(page, [fixture]);
  await mkdir('test-results/schedule', { recursive: true });
  await page.getByRole('button', { name: /^Lundi,/ }).click();
  await page.screenshot({ path: `test-results/schedule/planning-${width}.png` });
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await noOverflow(page);
  const opener = page.getByRole('link', { name: 'Ajouter un cours', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await noOverflow(page, 'dialog[open]');
  const bounds = await dialog.boundingBox();
  assert(bounds && bounds.x === 0 && bounds.y === 0 && bounds.width === width && bounds.height === height, 'the form must fill the screen');
  assert(await page.locator('.nav-tabs').isHidden() && await page.locator('.nav-header').isHidden());
  await page.screenshot({ path: `test-results/schedule/add-course-${width}.png` });
  await page.keyboard.press('Shift+Tab');
  assert(await dialog.getByRole('button', { name: 'Continuer', exact: true }).evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Tab');
  assert(await dialog.getByRole('button', { name: 'Fermer la fenêtre' }).evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Escape');
  await gone(dialog);
  assert(await opener.evaluate((element) => element === document.activeElement), 'closing the dialog must restore the opener');
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await page.getByRole('radio', { name: 'Sombre', exact: true }).check();
  await page.getByRole('link', { name: 'Planning', exact: true }).click();
  assert.equal(await page.locator('.navigator-shell').getAttribute('data-theme'), 'dark');
  await noOverflow(page);
  await page.getByRole('button', { name: /^Lundi,/ }).click();
  await page.screenshot({ path: `test-results/schedule/planning-dark-${width}.png` });
  if (width === 390) {
    await opener.click();
    await visible(page.getByRole('dialog', { name: 'Ajouter un cours', exact: true }));
    await page.screenshot({ path: 'test-results/schedule/add-course-dark.png' });
    await page.keyboard.press('Escape');
  }
});

check('mobile steps validate fields, preserve the draft on back and keep save above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole('link', { name: 'Ajouter un cours', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Ajouter un cours', exact: true });
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await visible(form.getByRole('alert'));
  assert.equal(await form.locator('form').getAttribute('data-step'), '1');
  await form.getByLabel('Bâtiment', { exact: true }).selectOption(buildingId);
  await form.getByLabel('Intitulé du cours', { exact: true }).fill('Analyse');
  await form.getByLabel('Salle', { exact: true }).fill('Amphi 2');
  await extraDetails(form);
  await form.getByLabel(/^Niveau/).fill('1.5');
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await visible(form.getByText(/Le niveau doit être un entier/));
  assert.deepEqual(await savedClasses(page), []);
  await form.getByLabel(/^Niveau/).fill('0');
  await form.getByLabel('Libellé personnel', { exact: true }).fill('TD groupe A');
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await visible(form.getByRole('heading', { name: 'À quel moment ?', exact: true }));
  await form.getByRole('button', { name: 'Ajouter au planning', exact: true }).click();
  await visible(form.getByText('Choisissez au moins un jour.', { exact: true }));
  await form.getByLabel('Lundi', { exact: true }).check();
  await form.getByLabel('Début', { exact: true }).fill('11:00');
  await form.getByLabel('Fin', { exact: true }).fill('10:00');
  await form.getByRole('button', { name: 'Ajouter au planning', exact: true }).click();
  await visible(form.getByText('La fin doit être après le début, le même jour.', { exact: true }));
  await form.getByRole('button', { name: 'Retour', exact: true }).click();
  assert.equal(await form.getByLabel('Intitulé du cours', { exact: true }).inputValue(), 'Analyse');
  assert.equal(await form.getByLabel('Libellé personnel', { exact: true }).inputValue(), 'TD groupe A');
  assert.equal(await form.getByLabel(/^Niveau/).inputValue(), '0');
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  assert(await form.getByLabel('Lundi', { exact: true }).isChecked());
  assert.equal(await form.getByLabel('Début', { exact: true }).inputValue(), '11:00');
  await form.getByLabel('Fin', { exact: true }).fill('12:00');
  await page.screenshot({ path: 'test-results/schedule/add-times-phone.png' });
  await page.setViewportSize({ width: 390, height: 430 });
  await form.getByLabel('Fin', { exact: true }).focus();
  const activeFieldVisible = () => page.waitForFunction(() => {
    const input = document.activeElement;
    const body = document.querySelector('.nav-schedule-form-body')?.getBoundingClientRect();
    const field = input?.getBoundingClientRect();
    return input?.matches('input[type="time"]') && body && field && field.top >= body.top && field.bottom <= body.bottom;
  });
  await activeFieldVisible();
  await noOverflow(page, 'dialog[open]');
  const save = form.getByRole('button', { name: 'Ajouter au planning', exact: true });
  const bounds = await save.boundingBox();
  assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 430, 'save must stay inside the shorter visual viewport');
  await page.screenshot({ path: 'test-results/schedule/add-times-short.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await activeFieldVisible();
  await noOverflow(page, 'dialog[open]');
  const landscape = await save.boundingBox();
  assert(landscape && landscape.y + landscape.height <= 390, 'save must stay visible in landscape');
  await page.screenshot({ path: 'test-results/schedule/add-times-landscape.png' });
  await save.click();
  await gone(form);
  const [saved] = await savedClasses(page);
  assert.equal(saved.title, 'Analyse');
  assert.equal(saved.label, 'TD groupe A');
  assert.equal(saved.floor, 0);
  assert.deepEqual(saved.days, [1]);
  assert.equal(saved.endTime, '12:00');
});

check('personal class links select the 3D building and clear stale class context', async ({ page }) => {
  await seed(page, [fixture]);
  await page.getByRole('button', { name: /^Lundi,/ }).click();
  await page.locator('.nav-session-main').click();
  await visible(page.locator('.nav-canvas-host[data-state="ready"]'));
  assert.equal(await page.locator('.nav-building-sheet').getAttribute('data-building-id'), buildingId);
  await visible(page.getByRole('region', { name: 'Votre cours dans ce bâtiment' }));
  await page.reload();
  await visible(page.getByRole('region', { name: 'Votre cours dans ce bâtiment' }));
  await page.getByRole('button', { name: 'Fermer les détails', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('class'), false);
  await gone(page.getByRole('region', { name: 'Votre cours dans ce bâtiment' }));
});

check('directory class links and original building links work without WebGL', async ({ page, context }) => {
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/i.test(type) ? null : getContext.call(this, type, ...args);
    };
  });
  let modelsRequested = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('.glb')) modelsRequested += 1; });
  await seed(page, [fixture]);
  await page.goto(`${base}/map?${new URLSearchParams({ view: 'list', building: buildingId, class: fixture.id })}`);
  await visible(page.getByRole('region', { name: 'Votre cours dans ce bâtiment' }));
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(modelsRequested, 0);
  await page.reload();
  await visible(page.getByRole('region', { name: 'Votre cours dans ce bâtiment' }));
  await page.goto(`${base}/?building=${encodeURIComponent(buildingId)}`);
  await page.waitForURL('**/explore?*');
  await visible(page.getByText('Amphithéâtres 1–6', { exact: true }).first());
  assert.equal(modelsRequested, 0);
});

let server;
let browser;
let failures = 0;
try {
  server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  for (const { name, run } of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Los_Angeles' });
    // Keep the suite hermetic without breaking the explorer stylesheet, which @imports Google Fonts.
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await run({ page, context });
      assert.deepEqual(errors, [], 'uncaught browser errors');
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}\n${error.stack ?? error}`);
      const artifact = `test-results/schedule/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
      await mkdir('test-results/schedule', { recursive: true });
      await page.screenshot({ path: `${artifact}.png`, fullPage: true }).catch(() => {});
      await writeFile(`${artifact}.txt`, await page.locator('body').innerText()).catch(() => {});
    } finally {
      await context.close();
    }
  }
  console.log(`${cases.length - failures}/${cases.length} production browser checks passed.`);
  if (!cases.length || failures) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
