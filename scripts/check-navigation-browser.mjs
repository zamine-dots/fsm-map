/** Phone-first navigation checks, using disposable profiles and simulated GPS. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { preview } from 'vite';

const cases = [];
const engine = process.env.FSM_BROWSER_ENGINE ?? 'chromium';
assert(['chromium', 'webkit'].includes(engine), 'FSM_BROWSER_ENGINE must be chromium or webkit');
const check = (name, run, options = {}) => { if (!process.env.FSM_CHECK_FILTER || name.includes(process.env.FSM_CHECK_FILTER)) cases.push({ name, run, options }); };
const courtyard = { latitude: 35.7643203, longitude: 10.8050401, accuracy: 8 };
const amphi2 = '/navigate?' + new URLSearchParams({ destination: 'room:way/620055880' });
const visible = (locator) => locator.waitFor({ state: 'visible' });
const gone = (locator) => locator.waitFor({ state: 'hidden' });
const summary = (page) => page.getByTestId('route-summary');
const search = (page) => page.getByRole('combobox', { name: 'Rechercher une salle ou un cours', exact: true });
let base;

async function open(page, path = amphi2) {
  await page.goto(base + path);
  await visible(page.locator('.journey'));
}
async function fromCourtyard(page) {
  await page.getByRole('button', { name: /^Cour Rouge Cour extérieure$/ }).click();
  await visible(summary(page));
}
async function noOverflow(page) {
  for (const selector of ['html', '.journey', '.journey-step-body', '.journey-bottom-card']) {
    const node = page.locator(selector);
    if (await node.count()) assert(await node.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), selector + ' overflows horizontally');
  }
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'the page must not scroll behind the full-screen flow');
}
async function fullScreen(page) {
  await noOverflow(page);
  assert.equal(await page.locator('.nav-tabs').isVisible(), false);
  assert.equal(await page.locator('.nav-header').isVisible(), false);
  const size = await page.locator('.journey').boundingBox();
  assert(size && size.y === 0 && Math.abs(size.height - await page.evaluate(() => window.innerHeight)) <= 1);
}
async function ready3D(page) {
  await visible(page.locator('.journey .nav-canvas-host[data-state="ready"]'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function tapPlanPoint(page, point, touch = false) {
  const screen = await page.locator('.route-campus-svg').evaluate((svg, [x, y]) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('The walking map has no screen transform.');
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    return { x: point.x, y: point.y, onMap: svg.contains(document.elementFromPoint(point.x, point.y)) };
  }, point);
  assert(screen.onMap, 'the requested starting point must be visible and tappable on the map');
  if (touch) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
}
async function stubGPS(context) {
  await context.addInitScript(() => {
    let sequence = 0;
    const watchers = new Map();
    const api = {
      starts: 0, stops: 0, freshStarts: 0, lastSuccess: null, lastFreshSuccess: null, options: null, freshOptions: null,
      freshRequests: [],
      send(value = {}) {
        const fix = { coords: { latitude: 35.7643203, longitude: 10.8050401, accuracy: 8, heading: null, ...value }, timestamp: value.timestamp ?? Date.now() };
        for (const watcher of watchers.values()) watcher.success(fix);
      },
      fail(code) { for (const watcher of [...watchers.values()]) watcher.error({ code }); },
      sendFresh(value = {}) {
        const request = this.freshRequests.shift();
        if (!request) throw new Error('No fresh GPS request is pending.');
        request.success({ coords: { latitude: 35.7643203, longitude: 10.8050401, accuracy: 8, heading: null, ...value }, timestamp: value.timestamp ?? Date.now() });
      },
      count: () => watchers.size,
    };
    window.__testGPS = api;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, error, options) { const id = ++sequence; watchers.set(id, { success, error }); api.starts++; api.options = options; api.lastSuccess = success; return id; },
      getCurrentPosition(success, error, options) { api.freshStarts++; api.freshOptions = options; api.lastFreshSuccess = success; api.freshRequests.push({ success, error }); },
      clearWatch(id) { if (watchers.delete(id)) api.stops++; },
    } });
  });
}

check('the app opens on Carte and two full-screen steps lead to the same 3D map', async ({ page }) => {
  const models = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('.glb')) models.push(new URL(request.url()).pathname); });
  await page.goto(base);
  await visible(page.locator('.nav-canvas-host[data-state="ready"]'));
  assert.equal(new URL(page.url()).pathname, '/map');
  await page.screenshot({ path: 'test-results/navigation/phone-carte.png' });
  const destinationButton = await page.getByRole('link', { name: 'Où allez-vous ?', exact: true }).boundingBox();
  assert(destinationButton && destinationButton.width >= page.viewportSize().width - 34 && destinationButton.height >= 64, 'the destination button must be prominent on the phone');
  assert.equal(await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link').count(), 3);
  assert.equal(await page.getByRole('group', { name: 'Commandes de la carte' }).getByRole('button').count(), 3);
  await page.getByRole('button', { name: 'Options de la carte', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Options de la carte', exact: true });
  await visible(options.getByRole('link', { name: 'Afficher la liste des bâtiments', exact: true }));
  await options.getByRole('checkbox', { name: 'Repères sur la carte', exact: true }).uncheck();
  await options.getByRole('checkbox', { name: 'Repères sur la carte', exact: true }).check();
  await page.keyboard.press('Escape');
  await gone(options);
  await page.getByRole('link', { name: 'Où allez-vous ?', exact: true }).click();
  await visible(search(page));
  await fullScreen(page);
  assert.equal(await page.locator('.journey-map-layer').count(), 0);
  await search(page).fill('Amphi 2');
  await page.screenshot({ path: 'test-results/navigation/phone-search.png' });
  await search(page).press('Enter');
  await visible(page.getByRole('heading', { name: 'Votre départ', exact: true }));
  await fullScreen(page);
  assert.equal(await search(page).count(), 0);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  await page.screenshot({ path: 'test-results/navigation/phone-start.png' });
  await fromCourtyard(page);
  await ready3D(page);
  await visible(page.getByTestId('position-3d'));
  await visible(page.getByTestId('route-3d-destination'));
  assert.match(await summary(page).innerText(), /1 min/);
  assert.match(await summary(page).innerText(), /69 m/);
  assert.match(await page.locator('.journey-arrival-line').innerText(), /Face avant/);
  assert.equal(await page.getByTestId('map-2d-fallback').count(), 0);
  assert.deepEqual(models, ['/model.glb'], 'navigation reuses the campus GLB already loaded by Carte');
  await fullScreen(page);
  await page.screenshot({ path: 'test-results/navigation/phone-navigation-3d.png' });
  await page.getByRole('button', { name: 'Étapes', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Étapes du trajet', exact: true }));
  await visible(page.locator('.route-arrival-selected'));
  await fullScreen(page);
  await page.getByRole('button', { name: 'Revenir à la carte', exact: true }).click();
  await visible(summary(page));
}, { webgl: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, lowPower: false });

check('native geolocation appears on the 3D map and reaches the correct classroom entrance', async ({ page, context }) => {
  await open(page);
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  await visible(summary(page));
  await ready3D(page);
  assert.equal(await page.getByTestId('position-3d').getAttribute('data-live'), 'true');
  assert.match(await summary(page).innerText(), /69 m/);
  await context.setGeolocation({ latitude: 35.7645326, longitude: 10.8048581, accuracy: 8 });
  await visible(page.getByText('Vous êtes arrivé', { exact: true }));
  assert.match(await summary(page).innerText(), /Arrivé/);
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await gone(page.locator('.journey'));
  assert.equal(new URL(page.url()).searchParams.has('navigate'), false);
}, { nativeGps: true, webgl: true });

check('Vercel-style HTTPS hosting serves deep links, assets and native phone geolocation', async ({ page, context }) => {
  const origin = 'https://fsm-navigator.test';
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const output = resolve(config.outputDirectory);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
  await context.route(origin + '/**', async (request) => {
    const pathname = new URL(request.request().url()).pathname;
    let file = resolve(output, '.' + pathname);
    if (!file.startsWith(output + '/')) file = '';
    let body = file ? await readFile(file).catch(() => null) : null;
    if (!body) {
      const rewrite = config.rewrites.find((rule) => new RegExp('^' + rule.source + '$').test(pathname));
      if (rewrite) {
        file = resolve(output, '.' + rewrite.destination);
        body = await readFile(file).catch(() => null);
      }
    }
    if (!body) { await request.fulfill({ status: 404, body: 'Not found' }); return; }
    const headers = Object.fromEntries(config.headers.flatMap((rule) => new RegExp('^' + rule.source + '$').test(pathname) ? rule.headers.map(({ key, value }) => [key, value]) : []));
    await request.fulfill({ status: 200, body, contentType: types[extname(file)] ?? 'application/octet-stream', headers });
  });
  const response = await page.goto(origin + amphi2);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['permissions-policy'], 'geolocation=(self)');
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  await visible(page.getByRole('heading', { name: 'Votre départ', exact: true }));
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  await visible(summary(page));
  await visible(page.getByTestId('walking-route'));
  assert.match(await summary(page).innerText(), /69 m/);
  await page.reload();
  await visible(page.getByRole('heading', { name: 'Votre départ', exact: true }));
  await gone(summary(page));
  await page.goto(origin + '/schedule');
  await visible(page.getByRole('link', { name: 'Ajouter un cours', exact: true }));
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
}, { nativeGps: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

check('GPS starts explicitly, rejects poor and stale fixes, and stops when leaving navigation', async ({ page }) => {
  await page.clock.install();
  await open(page);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  assert.equal(await page.evaluate(() => window.__testGPS.options.enableHighAccuracy), true);
  await page.evaluate(() => window.__testGPS.send());
  await visible(summary(page));
  await page.evaluate(() => window.__testGPS.send({ accuracy: 200 }));
  await visible(summary(page));
  await gone(page.getByText(/Position trop imprécise/));
  await page.evaluate(() => window.__testGPS.send({ timestamp: Date.now() - 31_000 }));
  await visible(summary(page));
  await page.clock.fastForward(31_000);
  await gone(summary(page));
  await visible(page.getByText(/signal GPS n’est plus à jour/));
  await page.evaluate(() => window.__testGPS.send());
  await visible(summary(page));
  const snapshot = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert(!snapshot.includes('latitude') && !snapshot.includes('longitude'));
  assert(!page.url().includes('35.764') && !page.url().includes('10.805'));
  await page.getByRole('button', { name: 'Fermer l’itinéraire', exact: true }).click();
  await page.waitForFunction(() => window.__testGPS.count() === 0);
  assert.equal(await page.evaluate(() => window.__testGPS.stops), 1);
  await page.getByRole('link', { name: 'Planning', exact: true }).click();
  await page.getByRole('link', { name: 'Carte', exact: true }).click();
  await page.getByRole('link', { name: 'Où allez-vous ?', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 1);
});

check('phone GPS refines a 77 km estimate and offers direct manual recovery without restart loops', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  assert.equal(await page.evaluate(() => window.__testGPS.options.maximumAge), 0);
  assert.equal(await page.evaluate(() => window.__testGPS.freshStarts), 1);
  assert.equal(await page.evaluate(() => window.__testGPS.freshOptions.enableHighAccuracy), true);
  assert.equal(await page.evaluate(() => window.__testGPS.freshOptions.maximumAge), 0);
  await page.evaluate(() => window.__testGPS.send({ accuracy: 77413 }));
  await visible(page.getByText('Affinement du GPS…', { exact: true }));
  await visible(page.getByText('Position approximative · ±77 km', { exact: true }));
  await gone(page.getByText(/Position trop imprécise/));
  await gone(summary(page));
  assert.equal(await page.getByRole('button', { name: /^Affinement du GPS/ }).isDisabled(), true);
  await page.evaluate(() => window.__testGPS.sendFresh());
  await visible(summary(page));
  assert.match(await summary(page).innerText(), /69 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 1);
  await page.evaluate(() => window.__testGPS.send({ accuracy: 77413 }));
  await visible(summary(page));
  await page.getByRole('button', { name: 'Fermer l’itinéraire', exact: true }).click();
  await open(page, '/map?navigate=1&from=cour-rouge&destination=room%3Away%2F620055880');
  await page.getByRole('button', { name: 'Activer le GPS', exact: true }).click();
  await page.evaluate(() => window.__testGPS.send({ accuracy: 77413 }));
  await visible(page.getByText('Affinement du GPS…', { exact: true }));
  await gone(page.getByRole('button', { name: 'Réessayer le GPS', exact: true }));
  await page.clock.fastForward(31_000);
  await visible(page.getByText(/Position trop imprécise.*±77 km/));
  await visible(page.getByRole('button', { name: 'Placer sur la carte', exact: true }));
  await fullScreen(page);
  await page.screenshot({ path: 'test-results/navigation/phone-gps-coarse.png' });
  await page.getByRole('button', { name: 'Placer sur la carte', exact: true }).click();
  await visible(page.locator('.journey[data-step="pick"]'));
  assert.equal(await page.evaluate(() => window.__testGPS.count()), 0);
  await page.evaluate(() => window.__testGPS.lastFreshSuccess({ coords: { latitude: 35.7643203, longitude: 10.8050401, accuracy: 8, heading: null }, timestamp: Date.now() }));
  assert.equal(await page.locator('.journey').getAttribute('data-step'), 'pick');
  await tapPlanPoint(page, [5, 50], true);
  await page.getByRole('button', { name: 'Confirmer ce point', exact: true }).click();
  await visible(summary(page));
  assert.match(await summary(page).innerText(), /75 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.count()), 0);
}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

check('denied, unavailable and timed-out GPS keep manual starting points available', async ({ page }) => {
  await open(page);
  for (const [code, message] of [[1, /Localisation refusée/], [2, /position est indisponible/], [3, /GPS met trop de temps/]]) {
    await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
    await page.evaluate((code) => window.__testGPS.fail(code), code);
    await visible(page.getByText(message));
    assert.equal(await page.evaluate(() => window.__testGPS.count()), code === 1 ? 0 : 1);
    await gone(summary(page));
  }
  await fromCourtyard(page);
  await page.evaluate(() => window.__testGPS.lastSuccess({ coords: { latitude: 0, longitude: 0, accuracy: 8, heading: null }, timestamp: Date.now() }));
  assert.match(await summary(page).innerText(), /69 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.count()), 0);
});

check('off-campus positions, unsupported GPS and missing destinations have short recovery actions', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  await page.evaluate(() => window.__testGPS.send({ latitude: 48.8566, longitude: 2.3522 }));
  await visible(page.getByText(/Vous êtes hors du campus/));
  await gone(summary(page));
  await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: /^Utiliser ma position/ }).click();
  await visible(page.getByText(/GPS indisponible sur ce navigateur/));
  await fromCourtyard(page);
  await open(page, '/navigate?destination=room%3Amissing-room');
  await visible(page.getByText(/Salle introuvable/));
  await gone(summary(page));
  await search(page).fill('unknown-room-9876');
  await visible(page.getByText(/Aucun résultat pour/));
});

check('personal classes keep their room entrance and floor while production ignores old editable pins', async ({ page, context }) => {
  const course = { id: 'routing-course', buildingId: 'way/1203834931', title: 'Analyse numérique', label: 'Mon TD', room: 'A-5', catalogCode: null, floor: 1, days: [1], startTime: '08:00', endTime: '10:00' };
  await context.addInitScript((course) => {
    localStorage.setItem('fsm-navigator-schedule-v1', JSON.stringify({ format: 'fsm-navigator-schedule', version: 1, campusId: 'fsm-campus', timezone: 'Africa/Tunis', exportedAt: '2026-10-21T08:00:00.000Z', classes: [course] }));
    localStorage.setItem('fsm-building-tags-v1', JSON.stringify({ format: 'fsm-building-tags', version: 1, campusId: 'fsm-campus', coordinates: 'local-metres', tags: [{ id: 'routing-tag', label: 'TP réseaux', buildingId: course.buildingId, floor: 0, point: [-44, 17], courseId: null }] }));
  }, course);
  await open(page, '/map?navigate=1');
  await search(page).fill('analyse numerique');
  await search(page).press('Enter');
  await fromCourtyard(page);
  assert.match(await page.locator('.journey-arrival-line').innerText(), /Face arrière/);
  assert.match(await page.locator('.journey-arrival-line').innerText(), /1er étage/);
  assert.match(await summary(page).innerText(), /109 m/);
  await page.locator('.journey-map-title').click();
  await search(page).fill('tp reseaux');
  await visible(page.getByText(/Aucun résultat pour/));
  assert.equal(await page.getByRole('option', { name: /^TP réseaux / }).count(), 0);
  await page.goto(base + '/map?navigate=1&from=cour-rouge&destination=tag%3Arouting-tag');
  await visible(page.getByText(/Salle introuvable/));
  await gone(summary(page));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fsm-building-tags-v1')).tags[0].label), 'TP réseaux', 'old drafts remain untouched');
});

check('official room names stay unplaced and planning requires the student to choose a building', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, '/map?navigate=1');
  await search(page).fill('INF30');
  const directory = page.getByRole('region', { name: 'Salles du planning officiel', exact: true });
  await visible(directory);
  assert.equal(await page.getByRole('option').count(), 0, 'unlocated rooms cannot be selected for routing');
  await noOverflow(page);
  await search(page).fill('INF.301');
  await visible(directory.getByText('INF.301', { exact: true }));
  await search(page).press('Enter');
  assert.equal(await page.locator('.journey').getAttribute('data-step'), 'destination');
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  await page.screenshot({ path: 'test-results/navigation/phone-official-room.png' });
  await directory.getByRole('link', { name: 'Ajouter un cours en INF.301', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Ajouter un cours', exact: true });
  await visible(form);
  assert.equal(await form.getByLabel('Salle', { exact: true }).inputValue(), 'INF.301');
  assert.equal(await form.getByLabel('Bâtiment', { exact: true }).inputValue(), '');
  assert.equal(await form.getByLabel('Niveau', { exact: true }).inputValue(), '');
  assert.equal(await form.locator('datalist option').count(), 130);
  await form.getByLabel('Intitulé du cours', { exact: true }).fill('TP informatique');
  await form.getByRole('button', { name: 'Continuer', exact: true }).click();
  await visible(form.getByText('Choisissez un bâtiment.', { exact: true }));
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await gone(form);
  assert.equal(new URL(page.url()).searchParams.has('room'), false);
  await open(page, '/map?navigate=1');
  await search(page).fill('A-2');
  assert.equal(await page.getByRole('option').count(), 1);
  await search(page).press('Enter');
  await fromCourtyard(page);
  assert.match(await page.locator('.journey-arrival-line').innerText(), /Amphi 2/);
  assert.match(await page.locator('.journey-arrival-line').innerText(), /Face avant/);
  assert.match(await summary(page).innerText(), /69 m/);
});

check('phone keyboard, short viewports and dark theme preserve full-screen setup and maps', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, '/map?navigate=1');
  await search(page).fill('Amphi 6');
  await search(page).press('ArrowDown');
  await search(page).press('ArrowUp');
  await fullScreen(page);
  await page.setViewportSize({ width: 390, height: 420 });
  await fullScreen(page);
  await search(page).press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  await fromCourtyard(page);
  await visible(page.getByTestId('map-2d-fallback'));
  await fullScreen(page);
  await page.screenshot({ path: 'test-results/navigation/phone-fallback.png' });
  await page.getByRole('button', { name: 'Fermer l’itinéraire', exact: true }).click();
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await page.getByRole('radio', { name: 'Sombre', exact: true }).check();
  await open(page, '/map?navigate=1&from=cour-rouge&destination=room%3Away%2F620055880');
  await visible(summary(page));
  assert.equal(await page.locator('.navigator-shell').getAttribute('data-theme'), 'dark');
  const courtyard = page.locator('.route-campus-svg [data-landmark-id="node/7228004560"]');
  assert.equal(await courtyard.evaluate((node) => getComputedStyle(node).fill), 'rgb(217, 163, 146)');
  assert.equal(await courtyard.evaluate((node) => getComputedStyle(node).fillOpacity), '1');
  await page.screenshot({ path: 'test-results/navigation/phone-dark.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await fullScreen(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullScreen(page);
});

check('a tap places a starting pin on the 3D campus and drags never select a point', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Placer sur la carte/ }).click();
  await ready3D(page);
  const canvas = page.locator('.journey canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.getByTestId('position-3d').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Confirmer ce point', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Voir tout le campus', exact: true }).click();
  await ready3D(page);
  const label = await page.locator('.nav-cour-label').boundingBox();
  assert(label);
  await page.touchscreen.tap(label.x + label.width / 2, label.y + label.height / 2);
  await visible(page.getByTestId('position-3d'));
  await visible(page.getByTestId('route-3d-destination'));
  await visible(page.getByTestId('origin-preview'));
  assert.match(await page.getByTestId('origin-preview').innerText(), /min.*m.*Amphi 2/);
  const pin = await page.getByTestId('position-3d').boundingBox();
  assert(pin && Math.hypot(pin.x + pin.width / 2 - label.x - label.width / 2, pin.y + pin.height / 2 - label.y - label.height / 2) < 3, 'previewing the route must not move the map under the selected point');
  await page.screenshot({ path: 'test-results/navigation/phone-place-origin.png' });
  await page.getByRole('button', { name: 'Confirmer ce point', exact: true }).click();
  await visible(summary(page));
  await ready3D(page);
  await visible(page.getByTestId('route-3d-destination'));
  assert.match(await page.locator('.journey-origin-link').innerText(), /Point sur la carte/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  await page.locator('.journey-origin-link').click();
  await page.getByRole('button', { name: /^Placer sur la carte/ }).click();
  await ready3D(page);
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await visible(page.getByTestId('position-3d'));
}, { webgl: true, viewport: { width: 390, height: 844 }, hasTouch: true });

check('custom starting points preview a route and unusable points stay in the picker', async ({ page }) => {
  await open(page);
  await fromCourtyard(page);
  await visible(page.getByTestId('walking-route'));
  await page.locator('.journey-origin-link').click();
  await page.getByRole('button', { name: /^Placer sur la carte/ }).click();
  await visible(page.getByTestId('map-2d-fallback'));
  const confirm = page.getByRole('button', { name: 'Confirmer ce point', exact: true });
  const preview = page.getByTestId('origin-preview');
  assert.equal(await confirm.isEnabled(), true, 'the existing origin keeps its route preview');
  await page.getByRole('button', { name: 'Voir tout le campus', exact: true }).click();
  const view = await page.locator('.route-campus-svg').getAttribute('viewBox');
  for (const { point, message } of [
    { point: [0, 0], message: /Choisissez un point sur une allée/ },
    { point: [94, 60], message: /Aucun chemin continu depuis ce point/ },
    { point: [-198, -11], message: /Vous êtes hors du campus/ },
  ]) {
    await tapPlanPoint(page, point, true);
    await visible(preview.filter({ hasText: message }));
    assert.equal(await confirm.isDisabled(), true, 'a point without a route cannot be confirmed');
    assert.equal(await page.locator('.journey').getAttribute('data-step'), 'pick');
    await gone(page.getByTestId('walking-route'));
  }
  await tapPlanPoint(page, [5, 50], true);
  await visible(page.getByTestId('walking-route'));
  assert.match(await preview.innerText(), /2 min.*75 m.*Amphi 2/);
  assert.equal(await confirm.isEnabled(), true);
  assert.equal(await page.locator('.route-campus-svg').getAttribute('viewBox'), view, 'moving the pin must not automatically pan or zoom the picker');
  const line = await page.locator('.route-line-halo').getAttribute('d');
  await page.screenshot({ path: 'test-results/navigation/custom-origin-preview.png' });
  await confirm.click();
  await visible(summary(page));
  await visible(page.getByTestId('walking-route'));
  assert.equal(await page.locator('.route-line-halo').getAttribute('d'), line, 'confirmation retains the previewed route');
  assert.match(await page.locator('.journey-origin-link').innerText(), /Point sur la carte/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  assert.equal(new URL(page.url()).searchParams.has('from'), false);
  const origin = line.match(/^M([^L]+)/)[1];
  for (const [title, distance, side] of [
    ['Amphi 1', 61, 'Face avant'], ['Amphi 3', 88, 'Face avant'],
    ['Amphi 4', 106, 'Face arrière'], ['Amphi 5', 92, 'Face arrière'],
    ['Amphi 6', 78, 'Face arrière'], ['Locaux Communs 1', 96, null],
  ]) {
    await page.locator('.journey-map-title').click();
    await search(page).fill(title);
    await search(page).press('Enter');
    await page.waitForFunction((title) => document.querySelector('.journey-arrival-line strong')?.textContent === title, title);
    await visible(page.getByTestId('walking-route'));
    await visible(summary(page).getByText(`${distance} m à pied`, { exact: true }));
    if (side) assert.match(await page.locator('.journey-arrival-line').innerText(), new RegExp(side));
    assert.equal((await page.locator('.route-line-halo').getAttribute('d')).match(/^M([^L]+)/)[1], origin, 'changing destination retains the custom origin');
    await fullScreen(page);
  }
  await page.screenshot({ path: 'test-results/navigation/custom-origin-building.png' });
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.journey-arrival-line strong')?.textContent === 'Amphi 6');
  assert.match(await summary(page).innerText(), /78 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
}, { viewport: { width: 390, height: 844 }, hasTouch: true });

check('2D and 3D switch within the route, and desktop and landscape keep the map visible', async ({ page }) => {
  await open(page, '/map?navigate=1&from=cour-rouge&destination=room%3Away%2F620055880');
  await ready3D(page);
  await visible(summary(page));
  const destination = new URL(page.url()).searchParams.get('destination');
  await page.screenshot({ path: 'test-results/navigation/desktop-navigation-3d.png' });
  await page.getByRole('button', { name: 'Afficher en 2D', exact: true }).click();
  await visible(page.getByRole('button', { name: 'Afficher en 3D', exact: true }));
  await ready3D(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await fullScreen(page);
  await page.screenshot({ path: 'test-results/navigation/phone-navigation-2d.png' });
  await page.getByRole('button', { name: 'Afficher en 3D', exact: true }).click();
  await ready3D(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await fullScreen(page);
  await page.screenshot({ path: 'test-results/navigation/landscape-navigation.png' });
  assert.equal(new URL(page.url()).searchParams.get('destination'), destination);
}, { webgl: true });

check('a failed map request can be retried and existing classroom links reach the new flow', async ({ page }) => {
  await page.route('**/data/campus.geojson', (route) => route.abort());
  await open(page, '/map?navigate=1&from=cour-rouge&destination=room%3Away%2F620055880');
  await visible(page.locator('.journey-loading').getByText('Carte indisponible', { exact: true }));
  await page.unroute('**/data/campus.geojson');
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await visible(summary(page));
  await visible(page.getByTestId('map-2d-fallback'));
  await page.goto(base + '/map?' + new URLSearchParams({ view: 'list', building: 'way/1203834931' }));
  await page.getByRole('link', { name: 'Itinéraire vers Amphi 4', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Votre départ', exact: true }));
  await fromCourtyard(page);
  assert.match(await summary(page).innerText(), /96 m/);
});

check('Cour Rouge is a courtyard landmark and its origin link opens classroom selection', async ({ page }) => {
  await open(page, '/map?navigate=1');
  await search(page).fill('courrouge');
  const result = page.getByRole('option', { name: 'Cour Rouge Cour extérieure · Repère du campus', exact: true });
  assert.equal(await result.getAttribute('data-place-kind'), 'landmark');
  await result.click();
  const card = page.getByRole('region', { name: 'Cour Rouge', exact: true });
  await visible(card);
  assert.equal(await card.getByText(/Amphi|étage|salle de cours/).count(), 0);
  await card.getByRole('link', { name: 'Partir d’ici', exact: true }).click();
  await visible(search(page));
  assert.equal(new URL(page.url()).searchParams.has('destination'), false);
  await search(page).fill('Amphi 2');
  await search(page).press('Enter');
  await visible(summary(page));
  assert.match(await summary(page).innerText(), /69 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
});

check('editing a trip preserves its manual origin and GPS is never restarted by history', async ({ page }) => {
  await open(page);
  await fromCourtyard(page);
  await page.locator('.journey-map-title').click();
  await search(page).fill('Amphi 6');
  await search(page).press('Enter');
  await visible(summary(page));
  await page.waitForFunction(() => document.querySelector('.journey-arrival-line strong')?.textContent === 'Amphi 6');
  assert.match(await summary(page).innerText(), /123 m/);
  await page.goBack();
  await visible(summary(page));
  await page.waitForFunction(() => document.querySelector('.journey-arrival-line strong')?.textContent === 'Amphi 2');
  assert.match(await summary(page).innerText(), /69 m/);
  assert.equal(await page.evaluate(() => window.__testGPS.starts), 0);
  await page.locator('.journey-origin-link').click();
  await visible(page.getByRole('heading', { name: 'Votre départ', exact: true }));
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await visible(search(page));
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await visible(summary(page));
});

let server;
let browser;
let failures = 0;
try {
  await mkdir('test-results/navigation', { recursive: true });
  server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  base = 'http://127.0.0.1:' + address.port;
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } : {}) });
  const iphone = devices['iPhone 13'];
  const defaults = engine === 'webkit' ? { userAgent: iphone.userAgent, viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: iphone.isMobile, hasTouch: iphone.hasTouch } : { viewport: { width: 1440, height: 960 } };
  console.log('Navigation browser engine: ' + engine);
  for (const { name, run, options: { nativeGps = false, webgl = false, lowPower = true, ...options } } of cases) {
    const context = await browser.newContext({ ...defaults, ...(nativeGps ? { geolocation: courtyard, permissions: ['geolocation'] } : {}), ...options });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    if (!nativeGps) await stubGPS(context);
    else if (engine === 'webkit') await context.addInitScript(() => {
      // Playwright's WebKit 2359 override reports microseconds. Correct only the
      // simulator metadata to standard milliseconds; permission and GPS APIs stay native.
      const descriptor = Object.getOwnPropertyDescriptor(GeolocationPosition.prototype, 'timestamp');
      if (!descriptor?.get) throw new Error('The WebKit GPS simulator has no native timestamp getter.');
      Object.defineProperty(GeolocationPosition.prototype, 'timestamp', { ...descriptor, get() {
        const value = descriptor.get.call(this);
        return value > Date.now() * 100 ? value / 1000 : value;
      } });
    });
    await context.addInitScript(({ webgl, lowPower }) => {
      if (!localStorage.getItem('fsm-navigator-preferences-v1')) localStorage.setItem('fsm-navigator-preferences-v1', JSON.stringify({ version: 1, state: { theme: 'light', lowPower, labels: true, mapMode: '3d' } }));
      if (!webgl) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
      }
    }, { webgl, lowPower });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await run({ page, context });
      assert.deepEqual(errors, [], 'uncaught browser errors');
      console.log('PASS ' + name);
    } catch (error) {
      failures++;
      console.error('FAIL ' + name + '\n' + (error.stack ?? error));
      const artifact = 'test-results/navigation/' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await page.screenshot({ path: artifact + '.png', fullPage: true }).catch(() => {});
      await writeFile(artifact + '.txt', await page.locator('body').innerText()).catch(() => {});
    } finally { await context.close(); }
  }
  console.log((cases.length - failures) + '/' + cases.length + ' navigation browser checks passed.');
  if (!cases.length || failures) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
