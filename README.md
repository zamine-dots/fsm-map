# FSM Navigator

An interactive campus navigator for the **Faculté des Sciences de Monastir**, built with Vite, React, TypeScript, React Three Fiber/Drei, Zustand and Tailwind CSS. The interface is in French.

**The hosted map is readonly.** Visitors can view classrooms, use GPS, choose a route starting point and maintain their own Planning. Adding, moving, deleting or importing room pins and correcting buildings is available only through `npm run dev` on a loopback address. Production builds, Vercel deployments and `npm run preview` hide these controls and ignore old browser-local map edits.

## Add room locations locally and publish them

1. Run `npm run dev` and open its `http://127.0.0.1:…` or `http://localhost:…` URL on the same computer.
2. Open `/map?view=list`, choose a building, then use **Plan 2D & tags → Ajouter un tag**. Choose the level, enter the room name, place its pin inside the building and press **Enregistrer le tag**. Existing local tags can be moved, renamed or deleted.
3. Press **Enregistrer dans le projet**. This writes the names, levels and positions for **all buildings and levels** to [`src/data/room-locations.json`](src/data/room-locations.json). Saving a tag alone keeps a browser draft; the project-save button makes it part of the deployable app. Course links and personal schedules are excluded from this shared file.
4. Run `npm run build`, then push the updated room-location file and deploy it on Vercel. Project saving does not trigger a deployment. Published pins appear in **Plan des salles**, building search and classroom navigation for everyone.

The initial room-location file is empty. Existing OSM spaces remain visible; new room positions should come from the owner's local placements. A pin supplies a room reference within a building, not a surveyed room outline or indoor corridor. A pin matching a unique mapped room keeps that room's existing ID and doorway. The local save endpoint validates placements, excludes courtyard holes and rejects stale saves; it runs only in Vite development. A non-loopback development URL also stays readonly.

**Current milestone: simple mobile navigation and Planning.** The app has three tabs: **Carte**, **Planning**, and **Réglages**. The prominent **Où allez-vous ?** button opens two full-screen steps for choosing a classroom and a starting point, then shows the route on the same 3D map. Planning uses compact daily cards and two full-screen steps for adding or editing a course. Cour Rouge, personal schedules and local room drafts are preserved. Navigation provides suggested outdoor guidance to a mapped entrance or an explicitly identified nearby path; access has not been surveyed on site.

The app opens **Carte** at `/map`. Navigation is integrated at `/map?navigate=1`; existing `/navigate` links redirect there while retaining their destination and named origin. **Planning** is at `/schedule`, and settings at `/settings`. The former **Maintenant** tab is removed; `/today` redirects to Planning. The complete original **FSM Explore** interface remains at `/explore`; old `/?building=...` links still open it. Original browser-local corrections and their storage key are preserved for local development.

## Find your classroom and walk there

1. Run `npm run dev`, open the printed URL and tap **Où allez-vous ?** on the 3D map.
2. Choose **Amphi 2** (also searchable as **A-2**), **101 LC**, a building, a published room or your own course on the full-screen search page. Local development also offers your draft tags.
3. On **Votre départ**, tap **Utiliser ma position**, or **Placer sur la carte** to preview the green route from your chosen point, then confirm it. Points without a usable mapped route show a short message and remain editable. **Cour Rouge** is also available as a named starting point.
4. Follow the green route on the full-screen 3D campus. Use the side controls to recenter, fit the route or switch to 2D. **Étapes** opens the directions and room plan separately; **Terminer** returns to Carte.

The map uses the existing `Map3D` renderer and cached campus GLB. The blue location marker, GPS accuracy circle, route and entrance marker use its original local-metre projection. Manual placement temporarily uses a top view of the same model; tapping places the pin, dragging moves the map, and keyboard arrows plus Enter place a point at the center. The route and destination marker update while placing the pin, without moving the map under your finger; confirmation keeps that route and fits it into view. Changing classrooms preserves the custom starting point. Camera fitting makes space for the phone's bottom card and does not reset on every GPS update. If WebGL is unavailable or lost, the same preview, validation and confirmation work on the SVG map.

Navigation setup, guidance, and the course editor hide the app header and bottom tabs. Touch controls, safe-area insets, dynamic viewport height and `visualViewport` resizing keep the flows usable with the phone keyboard. Planning's **Y aller** action links directly to a course's destination. Extra map controls, the building list, Cour Rouge centering and gesture help are grouped under **Options de la carte**. Cour Rouge has its own outdoor landmark card; **Partir d’ici** opens `/map?navigate=1&from=cour-rouge` to choose a classroom.

Room and floor details remain available in the compact arrival card and **Étapes**. Amphis 1–3 use their documented front doors; 4–6 use their rear doors. GPS cannot identify an indoor floor and the app does not invent indoor corridors. This remains a browser app; installable/offline support is not included.

GPS works on **HTTPS**, or **localhost on the same device**. An ordinary `http://192.168…` LAN URL does not enable phone GPS. A static HTTPS host must serve `index.html` for SPA routes such as `/navigate`, `/map` and `/schedule`. No API key or backend is required. The native browser permission is requested only when the user taps a location button.

Positions stay in memory on the navigation screen. They are not written to localStorage, put in links, or sent to a routing server. The GPS watch is cleared on **Terminer**, closing navigation, switching to a manual origin, and leaving the flow. Returning does not automatically restart it. Denied, unavailable, timed-out, stale (over 30 seconds) and imprecise (over 50 m) fixes get a short message and a manual alternative; stale/imprecise fixes do not produce live directions. Off-campus fixes do not produce fabricated off-campus routes.

### GPS on iPhone and Android

The location button requests a fresh high-accuracy watch and a fresh one-shot fix (`enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 20000`). Initial acquisition can refine for up to 30 seconds. A coarse first estimate shows **Affinement du GPS…** and a readable accuracy such as **±77 km**, while the watch continues to seek a usable fix. A coarse or older update cannot replace a still-fresh precise location. New precise updates follow the walker; keeping an earlier fix never extends its 30-second expiry. Transient GPS errors can recover through the existing watch, and callbacks from stopped or replaced requests are ignored.

On iPhone, allow location for Safari/the browser and enable **Precise Location** in iOS settings. On Android, enable device location and grant the browser precise location and this website location access. The app cannot override these settings or turn an approximate network/IP estimate into precise GPS. If accuracy stays over 50 m, **Placer sur la carte** is available directly during acquisition and after an error. Retrying creates a fresh request; repeated restarts are disabled during acquisition. Real outdoor accuracy needs testing on campus with the deployed HTTPS URL.

### More classroom names from the faculty timetable

The faculty's [published 2026–2027 first-semester timetable](https://www.fsm.rnu.tn/fra/articles/5528/emplois-du-temps---2026-2027---semestre-1) links to a public Edupage directory containing **130 room labels**. The attributed snapshot in `src/data/official-rooms.json` includes mathematics, computing, physics, chemistry and library labels. Planning offers them as room-name suggestions. Searching an unmapped name such as **INF.301** shows **Emplacement à confirmer** and an action to add a personal course; the student must choose its building, and no floor is prefilled.

Abbreviations **A-1…A-6** and **A-B/A-C** find the existing mapped amphitheatres, including when used in personal schedules. Their room IDs, outlines and entrance associations remain the same. The timetable supplies empty building IDs and no coordinates, floors or plans. No reliable faculty floor plan or additional room outlines were found in the public sources reviewed on 2026-10-23; the current OSM response still contains the same 31 mapped spaces. Unplaced names are kept outside the geographic catalog and cannot become route endpoints. A room number or department prefix alone is never used to infer a building or floor.

### How walking routes use the existing map

- `src/lib/walking-route.ts` derives a graph at runtime from the existing attributed `public/data/campus.geojson`: currently **86 campus outdoor ways, 308 nodes and 334 segments**. Only mapped footways/paths and campus service/living/pedestrian roads are used; restricted foot access and indoor ways are excluded. Shortest routes use segment distances in model metres.
- Junctions use shared coordinates, or an existing vertex lying on the same-layer segment. Crossing lines without a mapped junction and disconnected components are not joined by a proximity guess.
- The start is projected onto a nearby mapped segment (at most 25 m away). Short estimated connections are dashed and checked against buildings, gardens and walls. Mapped entrances can connect within 5 m; a room's explicit entrance is never silently exchanged for another room's door. Intermediate points on a segment are split for routing, so there is no detour through its far endpoints.
- A building without an attached entrance can receive an explicitly labelled route to a nearby path, at most 18 m from its footprint. If no adequate path/access is mapped, the building remains visible and the app explains that a route is unavailable. Neither a building centroid nor an unassigned entrance becomes an invented door.
- The hand-maintained `campus.json`, original geometry, model files, entrance `verified` flags and empty **reviewed** `walkNodes`/`walkEdges` arrays are unchanged. The runtime network is for **suggested** navigation, not a claim of surveyed access or wheelchair accessibility. Campus catalog course lists remain empty until actual course data is supplied; personal courses and owner-published rooms are searchable immediately.

### Navigation checks

```sh
npm run navigation:check
npm run build
npm run navigation:check:browser
```

The 25 focused logic checks cover geographic alignment, room/course search, official room names without invented locations, owner-published pins and their course/door associations, duplicate room names, amphitheatre abbreviations, Cour Rouge's outdoor classification, all six amphitheatre doors, source-path continuity, shortest distances, same-segment origins/destinations, disconnected paths, real junctions, layer separation, restricted ways, obstacle-aware connections, missing entrances, nearby-building endpoints, turns, unusable GPS fixes, refinement, expiry and readable accuracy estimates. They run as part of the production build.

The browser suite uses disposable Chromium contexts, simulated campus coordinates and temporary preview servers. Its 16 scenarios cover the shared 3D model, full-screen steps, native browser geolocation, arrival at a room's entrance, GPS cleanup and errors, coarse-to-precise refinement, official room search and required building selection, manual pin placement, drag rejection, keyboard use, short/320/390/1440px and landscape viewports, dark mode, personal courses, ignored old room pins, history, old room links, map retries and Cour Rouge's outdoor classification. An HTTPS scenario serves the production assets and deep links using the actual `vercel.json` and checks native simulated geolocation, reload and Planning. Custom-origin checks use phone touch events, preview the route before confirmation, reject off-path/off-campus/disconnected points, replace a named origin, and retain the custom point when switching between all six amphis and LC1. It runs both with WebGL and with WebGL disabled to exercise the SVG fallback. Screenshots are saved under `test-results/navigation/`. These checks do not establish real-phone frame rate, outdoor GPS accuracy or on-site access.

After building, `npm run check:browser` runs navigation, map/tag and schedule browser suites together.

With Playwright WebKit and its host libraries installed, select the iPhone profile for focused checks:

```sh
FSM_BROWSER_ENGINE=webkit FSM_CHECK_FILTER=GPS npm run navigation:check:browser
FSM_BROWSER_ENGINE=webkit FSM_CHECK_FILTER=Vercel npm run navigation:check:browser
FSM_BROWSER_ENGINE=webkit FSM_CHECK_FILTER=official npm run navigation:check:browser
```

The earlier GPS update passed seven focused WebKit scenarios using an iPhone profile: five GPS recovery/lifecycle cases, simulated HTTPS geolocation and the official-room Planning flow. WebKit build 2359's Playwright geolocation override reports microsecond timestamps; the fixture converts only that simulator metadata to standard milliseconds. Location permission and geolocation calls remain native in the HTTPS scenario, and the production GPS code keeps its timestamp validation. These are browser simulations, not real iPhone or Android GPS measurements.

Verified on 2026-10-24: production build, model/catalog integrity, all 64 logic/persistence checks (25 navigation, 20 map/tags, 19 schedule), and all 41 Chromium scenarios (16 navigation, 12 map, 13 schedule; 10 development scenarios and 31 production scenarios). Mobile checks include public room plans without editing, ignored browser map edits, saving local rooms into the project, fresh GPS refinement and late-callback cleanup, simulated Vercel HTTPS deep links, official room names without invented locations, custom-origin previews and validation, routes to all six amphis and LC1, the prominent map search, full-screen course entry, draft preservation, and keeping the focused field and save button visible when the viewport shrinks for a keyboard or rotates. Live-location tests use simulated coordinates; campus access and outdoor GPS accuracy still require field testing.

## Earlier milestones

The phase descriptions below document the earlier deliveries. Their references to future GPS/routing work describe the state at that milestone. The navigation and local-only map editing described above are current; earlier tag-editing acceptance steps require `npm run dev`.

## Phase 2 features

- Lazy-loaded, Meshopt-compressed GLB rendered with React Three Fiber; the decoder ships locally, not from a CDN.
- Touch orbit, two-finger pan/pinch, top-down 2D view, north alignment, zoom buttons and reset view.
- French, mobile-first shell with a persistent light/dark/system preference and bottom navigation.
- Low-power mode: unlit materials, no shadows and pixel ratio 1. Standard mode caps pixel ratio at 1.75 and renders on demand.
- Download progress, retry on model failure, WebGL context-loss handling and a link to the original accessible SVG plan.
- A single shared geometry generator for the original explorer and the export pipeline. No campus footprint has been replaced or enlarged.

### Phase 2 acceptance check

1. Run `npm run dev` and open the printed URL, then `/map`.
2. Rotate with one finger; pan/pinch with two. Try zoom, north, reset and 2D/3D. Focus the canvas to use arrow keys, `+`, `-`, `Home` and `n`.
3. Open **Réglages**, choose a theme and low-power mode, return to the map and reload. Preferences should persist when browser storage is available.
4. Open **Plan détaillé**, search **Bâtiment 27**, and check Amphis 1–3 on the front and 4–6 on the rear. Its height is estimated at 7 m; the original footprint is unchanged.
5. If WebGL is unavailable, open the offered accessible plan. The original explorer provides its selectable SVG fallback automatically.

Real-device frame-rate and outdoor GPS checks are reserved for the performance and routing phases; mobile viewport emulation is not a claim of 60 fps on a phone.

## Phase 3 features

- `src/data/campus.json`: the authoritative navigation catalog for **28 buildings, 31 mapped spaces and 50 entrance points**. There are 38 building-associated entrances (6 from the documented amphitheatre correction and 32 sharing exact OSM outline vertices); 12 remain unassigned. **All accesses remain unverified on site.** Runtime validation and `npm run campus:check` protect the catalog.
- Native search over names, codes, aliases, categories, spaces and course codes/titles, with accent/punctuation-insensitive matching (`LC1`, `LC 1`, `B27`, `Amphi 2`). Category chips, `↑`/`↓`, `Enter`, and `Escape` work without a mouse; `/` focuses search.
- A real **non-3D directory at `/map?view=list`**, reachable beside search and from settings. It loads neither the canvas nor the GLB and offers the same building sheets, including when WebGL is unavailable.
- Model and landmark selection with a static outline overlay; shared model materials remain untouched. Pointer movement beyond 5 px, drags returning to their starting point, right-clicks and multi-touch gestures do not select buildings.
- A non-modal desktop side card/mobile bottom sheet with category, codes, source/estimated floors, footprint, height, mapped spaces, entrance caveats and course lists or honest empty states. A multi-level room appears **once**, with its levels listed. Amphis 1–3 remain in front and 4–6 behind. “Me guider ici” is explicitly unavailable until Phase 6.
- Shareable `/map?building=<id>` and `/map?view=list&building=<id>` selections use React Router and ephemeral Zustand state, never localStorage. Unknown IDs produce a dismissible message.
- The one-off `scripts/seed-campus.ts` is **not part of the build** and refuses to overwrite an existing catalog. `--stdout` previews a fresh seed. Model exports and catalog checks never write `campus.json`.

### Phase 3 acceptance check

1. Run `npm run build`; it runs `model:check`, then the new `campus:check` (counts, source identifiers, derived values and GLB node names), then type-checking and bundling. `public/model.glb` and `src/data/model-manifest.json` must stay byte-identical.
2. On `/map`, press `/`, type `LC1`, `Amphi 2`, `B27` or `Mathématiques`, and open a result. `↑`/`↓` and `Enter` should work; `Escape` clears then closes. Try a category filter and an unmatched query.
3. Tap a building on the model, or a landmark label. A gold outline and ground ring appear without changing the building's colour. Drag the map: it rotates instead of selecting. Tap empty space: the selection clears.
4. At 390×844 and 320×568 the sheet stays scrollable above the bottom tabs, without horizontal overflow. Confirm six distinct amphitheatres and their front/rear sides, mapped level spans, unverified entrance notices and the unavailable navigation action.
5. Open the list-view button or go directly to `/map?view=list`. Search, filter and select a building without loading WebGL. A selected building link should survive a reload in either view.
6. Switch light/dark/low-power settings, reopen a selection and try the map help dialog. Escape in help should close only help, not the underlying sheet. Test the original `/explore` link too.
7. No invented courses or walk routes are seeded. Adding real `classes[]` entries manually is supported by search and the sheet; it does not require a model rebuild.

Verified for this milestone: production build, six focused data/selection checks, and 13 Chromium browser checks on both development and production bundles. Browser checks cover real mesh taps, keyboard use, 390×844 and 320×568 viewports, multi-touch, model failure, context loss and a browser without WebGL. These are emulated checks, not real-phone frame-rate or outdoor GPS measurements. The existing lazy Three.js chunk-size warning remains for the performance phase.

## Phase 4 features

- Add a personal class with its building, title, room, optional floor and label, one or more weekdays, and start/end times. Mapped room names are suggestions, not invented courses. Once actual courses are added to `campus.json`, the same form supports catalogue search by code, title, building and room.
- Edit or delete a recurring class; deletion asks for confirmation and removes all its weekly occurrences. The **Jour / Semaine** views work on mobile and desktop. Overlaps are allowed but explicitly flagged, including on the days where they occur.
- Planning opens on the current Monastir weekday. Cards show their time, subject, room and building; current classes are marked **En cours**. **Aujourd’hui** returns to the current day, and **Jour / Semaine** changes the view. There is no separate Maintenant screen.
- All times and weekday calculations use **Africa/Tunis**, even when the device uses another timezone. Start is inclusive, end is exclusive. The screen refreshes at minute boundaries and on focus/visibility after a phone sleeps.
- A class opens `/map?building=<id>&class=<personal-class-id>`, selecting the existing building and showing its personal room/floor/time details in the sheet. Choosing another building clears the class context. Building sheets offer **Ajouter un cours ici** and catalogue-to-planning links.
- Tapping a course opens its building sheet. **Y aller** opens the integrated route setup for that classroom. The model and geometry are unchanged.
- Schedules are validated and stored separately in localStorage, with JSON export/import, explicit replacement confirmation, corrupt-data recovery, storage failure warnings and cross-tab synchronization. Reads never overwrite an unreadable copy. Quota/permission errors leave edits usable in memory and prompt an export.

### Add your classes

1. Run `npm run dev`, open the printed URL and choose **Planning → Ajouter**. Enter your subject, building and room on the first full-screen step. **Plus de détails** contains the optional floor (`0` means ground floor) and personal label.
2. Tap **Continuer**, choose the weekdays, and enter start/end times in **Monastir time**. **Retour** keeps the draft while returning to the course details.
3. Tap **Ajouter au planning**. Use the pencil to edit or the trash icon to delete; deletion still requires confirmation. **Semaine** shows all seven days.
4. Tap a card to see its building, or **Y aller** to select a starting point and get a route. Location access starts only when you choose **Utiliser ma position**.

This is a **recurring week**, not an academic calendar: holidays, exam weeks, cancellations, alternate weeks and one-off date exceptions are not inferred. Sessions must finish after they start on the same day; overnight sessions are not supported. Limits: 250 recurring entries; titles 160 characters, rooms/labels/catalogue codes 100; floor integers −20…200 or unknown. An estimated building height is not used to reject a student's reported floor.

### Personal backup and recovery

Use the **…** button in Planning (**Options du planning**), or **Réglages → Exporter, importer ou récupérer le planning**. Backup tools open on a separate full-screen view; existing `/schedule#schedule-backup` links open it directly. Export before clearing browser data, changing devices or changing site origins: localStorage belongs to a specific browser profile, protocol, host and port. A Vercel preview URL and the eventual production URL therefore have separate data. Exported files contain personal class locations/times; keep them private.

The key `fsm-navigator-schedule-v1` and exported files share this versioned envelope. This is a **format example, not a seeded university course**:

```json
{
  "format": "fsm-navigator-schedule",
  "version": 1,
  "campusId": "fsm-campus",
  "timezone": "Africa/Tunis",
  "exportedAt": "2026-10-05T10:00:00.000Z",
  "classes": [
    {
      "id": "personal-example-1",
      "buildingId": "way/1203834931",
      "catalogCode": null,
      "title": "Example subject",
      "room": "Amphi 1",
      "floor": null,
      "label": "",
      "days": [1, 3],
      "startTime": "09:00",
      "endTime": "10:30"
    }
  ]
}
```

- Days follow ISO numbering: Monday `1` through Sunday `7`. Times must use strict 24-hour `HH:mm`. Each entry needs a unique ID. `catalogCode: null` identifies a freely entered class; catalogue information is copied into a personal snapshot, not a fragile live reference.
- Imports are checked completely before any replacement: format/version, campus/timezone, timestamps, times, day lists, duplicate IDs, string bounds, and a **1 MiB (1,048,576-byte)** file limit. Importing `campus.json` as a personal backup is rejected. Cancelled or invalid imports leave the current schedule unchanged.
- An imported building ID missing from the catalogue is retained and flagged for repair, not silently reassigned. Edit the course to choose its actual building; map navigation stays unavailable until then.
- Corrupt storage produces a visible warning and offers **Télécharger la copie originale** as text. New edits do not destroy that copy. Export your in-memory schedule first, then explicitly confirm **Enregistrer ce planning à la place**, import a valid backup, or confirm a reset.
- If storage is denied/full, changes work only in the current tab until successfully saved or exported. **Réessayer l’enregistrement** retries after permission/space is restored. Do not close/reload before exporting unsaved work.
- Changes from another tab are loaded when there are no unsaved edits. Conflicting in-memory work is not silently overwritten; recovery offers explicit replacement or reloading the saved copy. A stale open edit form refuses to overwrite a course changed in another tab.
- Clearing the planning changes only its dedicated key. Preferences (`fsm-navigator-preferences-v1`), legacy building corrections (`fsm-building-edits-v1`), campus data and model files stay intact. Nothing is uploaded to a backend.

### Phase 4 acceptance check

1. Run `npm run build`, then `npm run dev` (or `npm run preview` for the production build). Use the URL printed by Vite if port 3000 is busy.
2. Add a custom course on two weekdays; leave its floor blank. Reload, edit its label/time/floor, switch between **Jour / Semaine**, then cancel and confirm a deletion. Check that other classes remain.
3. Add two overlapping courses around the current Monastir time. Confirm both live badges, overlap notices and their change at the exact end time. Test midnight with browser clock emulation to verify that the default day follows Monastir. Changing the emulated device timezone must not change the result.
4. Open a course from **Planning**. Confirm the correct building, personal room/floor and schedule in its sheet. Select a different building: stale course details must disappear. **Ajouter un cours ici** preselects that building without inventing a room or time.
5. Export JSON, cancel a proposed import, try malformed/wrong-campus files, then restore a valid backup. A missing building ID must remain visible with a repair action. Import is replacement, not merging; keep a backup first.
6. In a **disposable browser profile**, test denied storage/quota errors and replace only `fsm-navigator-schedule-v1` with invalid JSON. The warning must appear without erasing the raw value. Enter a class in memory, export it, and explicitly confirm recovery. Do not simulate this against your only real schedule.
7. At 390×844 and 320×568, use forms and both timetable modes without page/dialog horizontal overflow. Tab and Shift+Tab stay in a dialog; Escape cancels and restores the opener's focus. Check light/dark modes, a 1440px weekly view, `/map?view=list`, `/explore` and the original building deep links.

### Repeatable Phase 4 checks

```sh
npm run schedule:check
npm run build
npm run schedule:check:browser
```

`schedule:check` runs 19 logic and persistence checks and is also part of `npm run build`. It covers Monastir date boundaries, overlapping classes, next-week rollover, validation, JSON backups, corrupt originals, denied/quota-limited storage, conflicting tab edits and explicit recovery. Storage checks use isolated in-memory copies, never a real browser profile. TypeScript scripts use Node's `--import tsx` loader, so build checks do not need the tsx CLI's IPC socket.

`schedule:check:browser` runs 13 Chromium acceptance scenarios against the built `dist/` app. It starts and stops its own temporary localhost preview and creates disposable browser contexts. Scenarios cover course CRUD, minute refresh in a different device timezone, the three-tab navigation and old `/today` redirect, imports and downloads, failed saves, cross-tab conflicts, dialog focus, 320/390/1440px layouts, themes, two-step validation and draft preservation, a short keyboard-sized viewport, 3D class links and the directory without WebGL. Screenshots and failure details are saved in the ignored `test-results/schedule/` directory. If Chromium is missing, install it with `npx playwright install chromium` before running the suite.

Validation status on 2026-10-11: the 19 schedule logic/persistence checks, the 12 map/tag checks, model/catalog integrity checks, type-checking and production bundling pass. Both production Chromium suites now run end to end and pass: 12/12 schedule scenarios and 8/8 map/tag scenarios. (Earlier attempts were blocked because Chromium was unavailable and the automatic approval service returned HTTP 503 before an external run could start; the suites are hermetic and fulfil the Google Fonts request locally so the original explorer's stylesheet still loads.) These checks do not establish real-phone frame rate or outdoor GPS accuracy.

## Cour Rouge and local room editing

- **Cour Rouge** (OSM node `7228004560`) is the central **outdoor courtyard**, with its own landmark card and search result. Selecting its 3D label clears any building or personal-class context. It has no classroom, floor or course record; its card can prepare a route **from** the courtyard to a classroom.
- Its **approximate** surface follows the four enclosing OSM footpaths and excludes the mapped garden islands. The supplied `satellite.png` was reviewed on 2026-10-21 for appearance: muted terracotta paving (`#d9a392`) with pale square joints. The same opaque paving is used in the 3D model, walking map and original SVG explorer. Grid spacing is illustrative, with joints clipped around the gardens. The OSM point and geometry remain the geographic reference; `src/data/cour-rouge.json` records the outline, boundary features, excluded gardens and appearance source. The image is not used as a texture or for georeferencing.
- In local development, building 2D plans (**Plan 2D & tags**, from a building sheet or the original explorer panel) let the owner add draft tags: a name, floor, position inside the footprint and optional personal-course link. Mapped rooms are offered as suggestions. **Enregistrer dans le projet** exports the room information to the shared source file.
- Local drafts use `fsm-building-tags-v1`, separately from the campus catalog and schedule, with JSON backup export/import, corrupt-copy retention, quota/unavailable handling and cross-tab conflict detection. Tag placement excludes open courtyard holes and anything outside the building. A tag whose linked class was deleted is kept and flagged for repair. The local store starts from published pins when no saved draft exists.
- Hosted **Plan des salles** views display the shared source pins with level selection and **Y aller** links. They contain no room editing, deletion, import or recovery controls and do not read old browser tags. The original explorer shares these published pins and courtyard paving even when WebGL is unavailable. Selecting **Voir Cour Rouge sur la carte** focuses the courtyard in 3D and 2D.

### Repeatable map/tag checks

```sh
npm run map:check
npm run build
npm run map:check:browser
```

`map:check` runs 20 logic and persistence checks as part of `npm run build`. Alongside draft storage and courtyard geometry, it validates the real published-room file, local-only editing, readonly stores, exclusion of course data, placement validation and atomic local saves with stale/concurrent-write protection. API fixtures write only to disposable temporary files.

`map:check:browser` runs 12 Chromium scenarios: 10 against a loopback Vite development server for local room editing, persistence, project-save payloads and courtyard controls, plus two production scenarios for readonly plans, ignored old browser edits and published-room search/navigation. Its production-room fixture is built in a temporary directory; browser POSTs are intercepted so test positions never enter the real source file. Failed scenarios write screenshots and text to the ignored `test-results/map/` directory.

### Maintaining the navigation catalog

`src/data/types.ts` documents the schema. The geographic snapshot is the **geometry source**, while `src/data/campus.json` owns navigation names, aliases, codes, class lists and entrance/graph records. `model-manifest.json` is only generated asset metadata.

- Keep building `id` and `modelNodeName` aligned with the GLB; `position.x/z` are the existing model's local metres, not longitude/latitude. The nominal origin is 35.7648 N, 10.80535 E. North is `-Z`; the visual ground offset `y: 0.28` is not an altitude.
- Short codes such as `INFO`, `MATH`, `LC1` and `AMPHI`, and the `B01`–`B28` aliases, are **app search aids, not confirmed official university codes**.
- `floors` is a count including the ground floor. A class's `floor: 0` means ground floor; `null` means unknown. A mapped room's `floors: [0, 1]` is one space spanning two levels, not two courses.
- Add actual courses to a building's `classes` array. For example, the following is a **schema example only, not a real FSM class**:

```json
{ "code": "EXAMPLE-101", "title": "Example course", "room": "Amphi 1", "floor": 0 }
```

- Course codes must be unique within a building. Run `npm run campus:check` and `npm run build` after editing. Builds validate but never replace the catalog, so real course lists survive model rebuilds.
- Do not guess an entrance's building from its nearest footprint. Existing associations come from shared OSM vertices or the documented user correction; `verified: false` means routing access has not been reviewed. Unknown entrance levels remain `[]`. Twelve unassigned source points remain available for later review.
- To add a new modeled building, first update the attributed geometry source and run `npm run model:build`, then add the matching catalog record. The integrity check identifies missing or mismatched mesh IDs. Do not run the seed script over a manually edited catalog; use `npx tsx scripts/seed-campus.ts --stdout` to inspect a fresh reference instead.
- The `/edit` UI and surveyed GPS calibration remain future work. Navigation uses the same nominal geographic projection as the base map. A future calibration can use 2–3 well-spaced surveyed landmarks paired with their model x/z; do not claim on-site GPS accuracy from the nominal projection alone.

## Run locally

Requires Node.js 22.12+ or a newer supported version.

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite. The preferred port is 3000; Vite chooses the next available port if necessary.

```sh
npm run build
npm run preview
```

The production output is in `dist/` and is readonly, including on localhost through `npm run preview`. It can be hosted on a static web server with SPA history fallback. No API key or backend is required. `npm run build` verifies the generated model, the hand-maintained campus catalog (`campus:check`), maps/tags (`map:check`), schedules (`schedule:check`) and navigation (`navigation:check`) before type-checking and bundling.

A ready-to-open model of the initial campus snapshot remains unchanged at [`exports/fsm-campus.glb`](exports/fsm-campus.glb). The current app loads [`public/model.glb`](public/model.glb). A corrected, uncompressed reference is generated at [`exports/fsm-campus-unoptimized.glb`](exports/fsm-campus-unoptimized.glb). The original explorer can still export a model including its browser-local edits with **Exporter → Modèle 3D**.

## Deploy on Vercel

1. Import this project into Vercel and select the **Vite** framework. Use Node.js **22.12+** or a supported newer version such as 24.
2. Keep the build command **`npm run build`** and output directory **`dist`**. `vercel.json` supplies these settings, SPA rewrites for direct `/map`, `/navigate`, `/schedule` and `/settings` links, and `Permissions-Policy: geolocation=(self)`.
3. Deploy, open the resulting **HTTPS** URL directly on the phone, then tap **Utiliser ma position** and allow precise location. Visitors see the room locations saved in the project and cannot change them through the app.

No backend, API key or environment variable is required. The existing `public/model.glb` and source data ship with the app; Vercel only checks the model during the build, so the archived `exports/` directory is not required. `.vercelignore` omits local logs, screenshots, archives, caches and workspace-only files from CLI uploads. This configuration has been checked against [Vercel's Vite guidance](https://vercel.com/docs/frameworks/frontend/vite) and exercised with a local simulated HTTPS deployment; an actual Vercel deployment and real-device GPS measurements have not been performed here.

## Rebuilding the optimized model

```sh
npm run model:build
npm run model:check
npm run build
```

The pipeline imports the existing `CampusScene` geometry, exports it using Three.js, removes unused attributes, deduplicates materials and applies Meshopt compression with 16-bit positions. There are no textures to recompress. Building meshes remain independent for future picking/highlighting; instanced windows and trees are retained.

| Asset | Bytes | Role |
| --- | ---: | --- |
| Initial archived GLB | 2,012,480 | Original, not overwritten |
| Corrected uncompressed GLB | 2,115,632 | Reproducible reference |
| Optimized app GLB | 662,232 | 68.7% smaller than the corrected reference |

Materials decrease from 246 to 32. The exporter decodes its output to verify every one of the 28 campus building mesh IDs, building bounds within 3 cm of the uncompressed model, the corrected amphitheatre height, and all six entrances. It enforces a 5 MB file budget. A source checksum prevents a stale model from silently reaching a production build.

`src/data/model-manifest.json` is generated metadata, not a second manually maintained campus database. Do not edit it by hand. Building meshes use deterministic names such as `building_way_1203834931`; additional parts use `_part_1`, `_part_2`, and so on. Display names and OSM IDs remain in node metadata.

After editing the source GeoJSON, the shared generator or `src/data/campus-corrections.ts`, rerun `npm run model:build` and reconcile the navigation catalog if the geometry changed. Browser-local edits in the original explorer do not automatically modify the static GLB or the navigation catalog; promote reviewed permanent corrections into their sources first. The campus editor remains Phase 7.

## Original explorer features

- Real OpenStreetMap building footprints, including courtyard holes and multipart outlines. The snapshot contains 28 non-roof buildings intersecting the FSM boundary and additional neighboring buildings and covered passages.
- Orbit, pan, zoom, a north control, an overview control, 2D mode, and optional automatic rotation.
- Search by building name, category, building number, or mapped room name, plus category filters.
- Building information: footprint area, recorded or estimated levels, estimated height, and an OpenStreetMap source link.
- Partial indoor plans for 31 mapped spaces. Buildings with room data offer a floor selector and a room list.
- Layer controls for buildings, gardens, paths, labels, architectural detail, and the campus boundary.
- Corrections to building names and level counts in local development, saved in this browser’s local storage. Corrections do not modify OpenStreetMap.
- Download of a complete 3D `.glb` model, plus GeoJSON with source attributes and local corrections kept separately.
- Shareable building links using `?building=way%2F126064593`, for example.
- A selectable SVG plan when WebGL is unavailable; responsive controls and reduced-motion support.

### Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Rotate in 3D | Left drag | One finger |
| Pan | Right drag; left drag in 2D | Two fingers; one in 2D |
| Zoom | Wheel; `+` / `-` | Pinch |
| Search | `/` | Search field in the building list |
| Move the focused map | Arrow keys | Drag |
| Overview | `Home` or overview button | Overview button |
| Clear selection | `Escape` while the map is focused | Close building details |

## Accuracy and sources

The campus is centered near **35.7648° N, 10.8054° E**. Its boundary is [OpenStreetMap way 687347611](https://www.openstreetmap.org/way/687347611).

The 3D model is a navigable interpretation of public map data, **not an architectural survey**:

- Building footprints, names, recorded levels, paths, gardens, and available room outlines come from OpenStreetMap.
- Recorded heights are used where available. Otherwise heights are calculated at **3.5 m per level**. Missing level counts default to two for university buildings and one for other buildings, with room coverage used to infer a higher minimum where mapped. These estimates are identified in the interface.
- Windows, parapets, rooftop equipment, materials, and trees are illustrative. Trees are generated deterministically inside mapped gardens and outside mapped buildings.
- Interior coverage is incomplete. Room membership is determined geometrically from the enclosing building footprint. No unmapped rooms are invented.
- Floor areas are approximate projected areas in square metres, excluding courtyard holes. They are not total usable floor space.
- Building inclusion in the FSM list is based on intersection with the mapped campus boundary; surrounding context is also visible.
- Local edits are personal working corrections, not independently verified measurements. Clearing browser storage removes them; export GeoJSON to keep a copy.
- Bâtiment 27 (`way/1203834931`) is identified by the user as Amphithéâtres 1–6, with Amphis 1–3 on the front and 4–6 on the rear. OSM rooms span levels 0–1, giving an estimated 7 m building height. The approximately 964.29 m² footprint is unchanged; no wider footprint was assumed.

`satellite.png` is the original image supplied in the workspace. Its visible label references ENIM, and it has no georeferencing information. It has therefore not been used to position FSM buildings or as a map texture.

Map data is **© OpenStreetMap contributors**, licensed under **ODbL 1.0**. See [DATA-SOURCES.md](DATA-SOURCES.md) and the attribution embedded in `public/data/campus.geojson`. This is an independent project, not an official faculty service.

## Updating the campus data

The importer accepts a complete OSM XML bounding-box response. It preserves multipolygon courtyards, joins split rings, and removes contributor account metadata.

```sh
curl --fail --location 'https://www.openstreetmap.org/api/0.6/map?bbox=10.8029,35.7628,10.8078,35.7669' --output /tmp/fsm-campus.osm
npm run import:osm -- /tmp/fsm-campus.osm
npm run model:build
npm run build
```

Review updates before publishing: OSM names, boundaries, rooms and level counts can change. Unknown buildings can be named locally using **Ajuster les détails**. Permanent changes to the source model belong in the data or in an appropriately attributed supplementary dataset.

## Project structure

- `src/NavigatorApp.tsx`, `src/pages/`, `src/components/Map3D.tsx`: shell, Carte/Planning/Settings pages and lazy R3F map.
- `src/store/useAppStore.ts`: validated, versioned local preferences and ephemeral camera commands.
- `src/store/useScheduleStore.ts`: personal class CRUD, safe persistence, recovery and cross-tab conflict handling.
- `src/lib/schedule.ts`, `src/lib/useNow.ts`: validated weekly entries, campus-time occurrence calculations, overlaps and live clock refresh.
- `src/lib/storage.ts`: versioned personal backup format, validation, optimistic writes and downloads.
- `src/components/ScheduleForm.tsx`, `src/components/WeeklyTimetable.tsx`, `src/planning.css`: full-screen course entry and compact daily/weekly timetable.
- `src/components/BuildingPlan2D.tsx`, `src/lib/building-tags.ts`, `src/store/useBuildingTags.ts`: local room drafts with safe persistence, backup and cross-tab handling; readonly published plans in production.
- `src/data/room-locations.json`, `src/lib/room-locations-format.ts`, `src/lib/published-room-locations.ts`: owner-supplied room pins included in every deployment, validated during the build.
- `src/lib/campus-editing.ts`, `scripts/local-campus-editor.ts`: loopback-development editing gate and atomic save-to-project endpoint; no production write service.
- `src/lib/campus-landmarks.ts`, `src/data/cour-rouge.json`: Cour Rouge reference point and approximate courtyard surface.
- `scripts/check-map.ts`, `scripts/check-map-browser.mjs`: map/tag data checks (`npm run map:check`) and local/production Chromium checks (`npm run map:check:browser`).
- `src/components/AppDialog.tsx`, `src/components/ScheduleBackupPanel.tsx`: keyboard-accessible dialogs and local backup/recovery UI.
- `src/navigator.css`: Tailwind entry and responsive light/dark interface.
- `scripts/build-model.ts`: reproducible GLB export, compression and integrity checks.
- `scripts/seed-campus.ts`: one-off, non-wired bootstrap of `src/data/campus.json` from the OSM snapshot and user corrections.
- `scripts/check-campus.ts`: read-only assertions run by `npm run campus:check`.
- `src/data/campus.json`: validated campus catalog (buildings, rooms, entrances and real course lists), separate from personal schedules.
- `src/lib/campus-validation.ts`: strict parser for `campus.json`.
- `src/lib/campus-catalog.ts`: validated catalog, lookups, search and labels.
- `src/lib/useLiveLocation.ts`: fresh GPS acquisition, refinement, fix selection, expiry and cleanup for phone browsers.
- `src/data/official-rooms.json`, `src/lib/official-rooms.ts`, `src/lib/room-names.ts`: attributed timetable room names and mapped-room abbreviations without inferred geometry.
- `vercel.json`, `.vercelignore`: static HTTPS deployment, SPA routing and CLI upload exclusions.
- `src/components/campus/`, `src/components/map/`: native search, building sheet, picking, selection marker and landmark labels.
- `src/lib/campus-scene.ts`: original geometry extracted into a shared, browser-independent generator.
- `src/data/model-manifest.json`: generated sizes, coordinate reference and landmark metadata.
- `scripts/import-osm.mjs`: reproducible OSM XML to GeoJSON import.
- `public/data/campus.geojson`: attributed geographic source snapshot, in WGS84.
- `src/lib/campus.ts`: local metre projection, areas, room membership, search metadata and local edits.
- `src/lib/viewer.ts`: Three.js scene, batched geometry, controls, labels, floor views and GLB export.
- `src/components/`: map, SVG fallback, building details, preview and modal components.
- `src/App.tsx`: campus explorer and interactions.
- `src/styles.css`: responsive layout and visual design.

The scene uses local metres with east along `+X`, up along `+Y`, and north along `-Z`. The WGS84 origin is stored in the dataset and in exported model metadata. The visual base slab is not a terrain elevation model. GLB exports include all exterior geometry regardless of the current layer toggles; indoor source geometry is included in GeoJSON.
