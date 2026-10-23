# Campus data attribution

## OpenStreetMap

- Attribution: **© OpenStreetMap contributors**
- License: Open Database License 1.0 (ODbL)
- Copyright and license information: https://www.openstreetmap.org/copyright
- License text: https://opendatacommons.org/licenses/odbl/1-0/
- Campus boundary: https://www.openstreetmap.org/way/687347611
- Source request: https://www.openstreetmap.org/api/0.6/map?bbox=10.8029,35.7628,10.8078,35.7669
- Download date: recorded as `metadata.retrievedAt` in `public/data/campus.geojson`.

`public/data/campus.geojson` is a filtered and transformed OpenStreetMap snapshot. Keep its attribution and license metadata when sharing the data. The map interface, GeoJSON downloads and GLB model metadata carry the source attribution. If you publish screenshots or renders, include visible attribution to OpenStreetMap contributors and a link to the copyright page. Public redistribution of a derivative database must comply with ODbL.

## Model interpretation

OpenStreetMap provides the geographic footprints and mapped attributes. Heights inferred from levels, fallback level counts, façade windows, parapets, rooftop equipment, planting, and material colors are generated visual interpretations. They are not surveyed details.

User corrections remain separately attributed local edits in GeoJSON exports. They do not change the original OSM tags or update the upstream map.

## Campus catalog

`src/data/campus.json` is the phase 3 campus catalog. It is derived from the same `public/data/campus.geojson` OpenStreetMap snapshot (retrieved 2026-10-02) plus the single reviewed correction in `src/data/campus-corrections.ts`. It was bootstrapped once by the checked-in, non-wired `scripts/seed-campus.ts` and is now hand-maintained; `scripts/check-campus.ts` only reads and asserts. It keeps the ODbL attribution.

Footprint areas, floor counts and categories come from the OSM geometry and tags. Only `way/1203834931`'s two Amphi floors are inferred from mapped rooms; every height without an OSM `height` tag is estimated at 3.5 m per level. Twelve campus entrance nodes remain in `unassignedEntrances` with `association: "unassigned"` and `verified: false`; no association is guessed by proximity, and the nine non-campus entrance nodes are excluded. Course lists (`classes[]`) remain empty until actual course data is supplied, and the reviewed pedestrian graph (`walkNodes`/`walkEdges`) remains empty pending field review. The runtime outdoor network is described below.

## Amphitheatre identification

The user identified building `way/1203834931` as **Amphithéâtres 1–6**: Amphis 1, 2 and 3 face the front, while 4, 5 and 6 face the rear. This supplementary attribution is recorded in `src/data/campus-corrections.ts`. Room outlines and entrance positions remain the mapped OSM geometry. Room level tags `0;1` support an estimated 7 m volume at 3.5 m per level; they are not a surveyed height or twelve separate rooms. No footprint enlargement has been assumed.

The optimized `public/model.glb` is derived from the same shared geometry as the original explorer. Its node metadata retains source attribution, geographic origin, stable building IDs and the supplementary amphitheatre correction. The initial `exports/fsm-campus.glb` remains archived and predates this correction.

## Navigation catalog

`src/data/campus.json` is an attributed derivative of the same geographic snapshot, not a new survey. Its 28 building IDs and 31 mapped spaces match the existing model. Thirty-two entrance associations share an exact OSM building-outline vertex; six more use the separately attributed amphitheatre correction. Twelve remaining entrance points stay unassigned rather than being attached to a nearby building by guesswork. None of the 50 access points has on-site routing/accessibility verification. Unknown entrance levels are not silently assumed to be the ground floor.

Short codes and building numbers are application search aids, not confirmed official campus codes. Catalog course lists and the reviewed walking graph are empty until real information is supplied. A room spanning levels 0 and 1 remains one mapped space. Preserve the catalog's source and correction metadata when exporting or publishing it.

## Supplied image

The existing `satellite.png` was reviewed on 2026-10-21 at the user's request to correct **Cour Rouge's appearance**. It shows muted terracotta paving with pale square joints and garden islands. A paving sample near pixels x160–181/y286–328 gives median RGB 217, 163, 146 (`#d9a392`). The generated paving uses that color and an illustrative 4.5 m grid; it does not reproduce a surveyed tile layout.

The user identified Cour Rouge as an **outdoor courtyard**, not a classroom. Its OSM reference point (`node/7228004560`) and approximate outline from four enclosing OSM footpaths remain unchanged. Existing garden polygons are cut out of both the paving and its grid lines. The appearance reference and geometry attribution are recorded separately in `src/data/cour-rouge.json`.

The image itself is not included in the app or model exports and is not used as a texture or geographic reference. Its provider and georeferencing have not been established; all geographic coordinates continue to come from the attributed OSM snapshot.

## Suggested walking navigation (2026-10-21)

The integrated `/map?navigate=1` flow (also reachable through old `/navigate` links) uses the same OpenStreetMap geometry, 3D campus asset and coordinate origin as Carte. Its runtime outdoor walking network is derived from 86 campus paths/service ways (308 coordinate nodes, 334 segments) in `public/data/campus.geojson`. Source-way IDs are retained on route segments. Dynamic route lines and GPS markers are drawn in the model's existing local metres. Route calculations and manual pin placement do not edit the source geometry, regenerate the model or replace `campus.json`.

Shared vertices define junctions; geometrically crossing ways without a mapped junction and nearby disconnected paths are not connected by guesswork. Private/forbidden foot access and indoor ways are excluded. Short start/access connections are explicitly approximate, limited in length and checked against mapped buildings, gardens and walls. The normal path segments retain the source OSM geometry, including mapped paths within landscaped areas.

All existing entrance `verified: false` values remain unchanged. The six documented amphitheatre doors preserve their front/rear and room associations. Suggested routes may use a mapped but unverified door; a route to a building with no associated door stops on a nearby mapped path and identifies that limitation. Neither unassigned entrances nor building centroids are used as invented doors. The catalog's reviewed `walkNodes` and `walkEdges` remain empty pending a field review.

GPS uses the base map's nominal metres projection; neither anchor calibration nor indoor/floor positioning is claimed. Locations and route calculations stay in the browser and are not sent to any external routing provider. The map and route view retain visible OpenStreetMap/ODbL attribution.

## Faculty timetable room names (2026-10-23)

- Publisher: **Faculté des Sciences de Monastir**.
- Faculty announcement: https://www.fsm.rnu.tn/fra/articles/5528/emplois-du-temps---2026-2027---semestre-1
- Public timetable linked from that announcement: https://fsm.edupage.org/timetable/view.php?num=20&class=*234
- Retrieved: **2026-10-23**, published first-semester timetable for **2026–2027**.
- Local snapshot: `src/data/official-rooms.json`.

The public timetable's `classrooms` table contains **130 room labels**, their opaque source IDs and abbreviations. Only those fields are retained; surrounding timetable, teacher and student records are excluded. Names and abbreviations are trimmed while preserving the publisher's spelling. The publisher does not specify a reuse license for this directory; it is separately attributed and does not alter the OSM database's license.

Every published `buildingid` is empty, and no floor, geographic coordinate, outline or entrance is supplied. These names are searchable when no mapped destination matches and are offered as Planning room suggestions. Unplaced names show **Emplacement à confirmer**. Adding a course pre-fills only the room name and requires the student to choose its building; it leaves the floor unknown. Department prefixes and room numbers are not physical-position evidence.

Existing mapped amphitheatre names accept the search abbreviations **A-1…A-6** and **A-B/A-C**, also found in the directory. This is name matching against the existing OSM/user-corrected rooms, not new survey data. The same room IDs, footprints, levels and front/rear entrance associations are preserved. Duplicate names such as **Bib B1** cannot identify a unique room or doorway.

The faculty's public timetable, department pages and download directory were reviewed for a campus/floor plan; no reliable classroom plan was found. A current response from the same OSM bounding-box request still contains the same 31 indoor room IDs as the checked-in snapshot. The original geographic snapshot, its retrieval date, campus catalog, room geometry and model are unchanged. More exact placements require a georeferenced plan or on-site confirmation.

## Owner-maintained room locations (2026-10-24)

`src/data/room-locations.json` is a separate source for room pins placed by the project owner in local development. It starts empty and contains only stable pin IDs, building IDs, room names, levels and positions in the existing model metres. The owner saves it with **Enregistrer dans le projet**, then pushes and deploys the file. Personal schedules and course links are excluded.

These placements are owner-supplied references inside existing building footprints. They do not add surveyed room outlines, corridors, GPS calibration or verified access. Names matching a unique mapped space retain its OSM room ID and entrance association; other pins identify a building and an arrival reference while outdoor routes continue to use the existing path network and mapped access. The build checks every pin against its building footprint and courtyard holes. Public room views and routes use only this deployed snapshot; visitor-local tags and building corrections are ignored, and the write endpoint exists only in loopback Vite development.

Automated save and browser checks use disposable files/builds and intercepted requests. Their sample classroom placements are never added to the actual room-location source. The original 28 buildings, 31 mapped spaces, geographic snapshot, model and entrance verification flags remain unchanged.
