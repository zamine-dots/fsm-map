import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { boundsOf, centroid, prepareCampus, type CampusData } from '../src/lib/campus';
import { CampusScene, buildingMeshName, disposeGroup } from '../src/lib/campus-scene';
import { COUR_ROUGE, courRougePosition } from '../src/lib/campus-landmarks';

const modelPath = 'public/model.glb';
const manifestPath = 'src/data/model-manifest.json';
const sizeLimit = 5_000_000;
const sourceFiles = [
  'public/data/campus.geojson',
  'src/data/campus-corrections.ts',
  'src/data/cour-rouge.json',
  'src/lib/campus.ts',
  'src/lib/campus-scene.ts',
  'src/lib/campus-landmarks.ts',
  'scripts/build-model.ts',
];
const hash = (content: Uint8Array | string) => createHash('sha256').update(content).digest('hex');

async function sourceHash(): Promise<string> {
  const contents = await Promise.all(sourceFiles.map((path) => readFile(path)));
  return hash(Buffer.concat(contents));
}

async function checkModel() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const binary = await readFile(modelPath);
  assert.equal(manifest.sourceHash, await sourceHash(), 'Model sources changed. Run npm run model:build.');
  assert.equal(manifest.modelHash, hash(binary), 'Model checksum differs. Run npm run model:build.');
  assert(binary.length < sizeLimit, 'Model exceeds the 5 MB mobile budget.');
  console.log(`Model verified: ${(binary.length / 1_000_000).toFixed(2)} MB, ${manifest.counts.buildings} campus buildings.`);
}

async function buildModel() {
  // The texture-free Three.js exporter only needs this browser API to assemble a binary Blob.
  class BinaryFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;

    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader = BinaryFileReader as unknown as typeof FileReader;

  const data = JSON.parse(await readFile('public/data/campus.geojson', 'utf8')) as CampusData;
  const model = prepareCampus(data);
  const scene = new CampusScene(model);
  let source: Uint8Array;
  try {
    const binary = await new GLTFExporter().parseAsync(scene.modelRoot, { binary: true, onlyVisible: false });
    assert(binary instanceof ArrayBuffer, 'Expected a binary glTF export.');
    source = new Uint8Array(binary);
  } finally {
    disposeGroup(scene.modelRoot);
  }

  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const document = await io.readBinary(source);
  const materialsBefore = document.getRoot().listMaterials().length;
  const buildingBounds = new Map(model.campusBuildings.map((building) => {
    const node = document.getRoot().listNodes().find((candidate) => candidate.getName() === buildingMeshName(building.id));
    assert(node, `Missing source mesh for ${building.id}`);
    return [building.id, getBounds(node)] as const;
  }));

  // Do not flatten or merge building nodes: picking, names and georeferencing must survive compression.
  await document.transform(
    prune({ keepLeaves: true, keepExtras: true }),
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MATERIAL] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }),
  );
  const optimized = await io.writeBinary(document);
  assert(optimized.length < sizeLimit, 'Optimized model exceeds 5 MB.');
  const roundTrip = await io.readBinary(optimized);
  for (const building of model.campusBuildings) {
    const node = roundTrip.getRoot().listNodes().find((candidate) => candidate.getName() === buildingMeshName(building.id));
    assert(node, `Optimization lost building node ${building.id}`);
    assert(node.getMesh(), `Optimization lost selectable mesh ${building.id}`);
    assert.equal(node.getExtras().buildingId, building.id);
    const before = buildingBounds.get(building.id)!;
    const after = getBounds(node);
    for (const side of ['min', 'max'] as const) {
      for (let axis = 0; axis < 3; axis++) {
        assert(Math.abs(before[side][axis] - after[side][axis]) < 0.03, `Optimization moved ${building.id} by over 3 cm.`);
      }
    }
  }
  const amphitheatres = roundTrip.getRoot().listNodes().find((node) => node.getExtras().osmId === 'way/1203834931');
  assert.equal(amphitheatres?.getExtras().height, 7);
  assert.equal(amphitheatres?.getExtras().displayName, 'Amphithéâtres 1–6');
  assert.equal(roundTrip.getRoot().listNodes().filter((node) => node.getExtras().entranceId).length, 6);
  const cour = roundTrip.getRoot().listNodes().find((node) => node.getName() === COUR_ROUGE.modelNodeName);
  assert.equal(cour?.getExtras().landmarkId, COUR_ROUGE.id, 'Cour Rouge reference must survive model compression.');
  assert(cour?.getMesh(), 'Cour Rouge must keep its full courtyard surface.');

  const center = centroid(model.boundary[0]);
  const landmarkIds = ['way/1203834931', 'relation/3375368', 'way/126064600', 'way/126064615', 'way/126064593'];
  const manifest = {
    schemaVersion: 1,
    name: data.metadata.name,
    model: 'model.glb',
    sourceHash: await sourceHash(),
    modelHash: hash(optimized),
    origin: { latitude: data.metadata.origin[1], longitude: data.metadata.origin[0] },
    units: 'metres',
    north: '-Z',
    center: { x: center[0], z: center[1] },
    bounds: boundsOf(model.boundary[0]),
    counts: { buildings: model.campusBuildings.length, rooms: model.rooms.length },
    source: { attribution: data.metadata.attribution, license: data.metadata.license, url: data.metadata.licenseUrl, retrievedAt: data.metadata.retrievedAt },
    sizes: { archivedBytes: (await stat('exports/fsm-campus.glb')).size, sourceBytes: source.length, optimizedBytes: optimized.length, materialsBefore, materialsAfter: roundTrip.getRoot().listMaterials().length },
    landmarks: model.campusBuildings.filter((building) => landmarkIds.includes(building.id)).map((building) => ({
      id: building.id,
      modelNodeName: buildingMeshName(building.id),
      name: building.shortName,
      x: building.center[0],
      z: building.center[1],
      height: building.height,
    })),
    referencePoints: [{ id: COUR_ROUGE.id, name: COUR_ROUGE.name, modelNodeName: COUR_ROUGE.modelNodeName, position: courRougePosition(data.metadata.origin), color: COUR_ROUGE.color, geometry: 'courtyard-surface', outlineApproximate: true }],
  };
  await mkdir('exports', { recursive: true });
  await writeFile('exports/fsm-campus-unoptimized.glb', source);
  await writeFile(modelPath, optimized);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Corrected source: ${source.length.toLocaleString('en')} bytes`);
  console.log(`Optimized model:  ${optimized.length.toLocaleString('en')} bytes (${(100 * (1 - optimized.length / source.length)).toFixed(1)}% smaller)`);
  console.log(`Materials: ${materialsBefore} → ${manifest.sizes.materialsAfter}. All ${model.campusBuildings.length} campus mesh IDs and six amphitheatre entrances verified.`);
}

if (process.argv.includes('--check')) await checkModel();
else await buildModel();
