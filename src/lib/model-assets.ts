import manifest from '../data/model-manifest.json';

// Generated asset metadata; navigation names and course lists belong to campus.json.
export const modelManifest = manifest;
export const MODEL_URL = `${import.meta.env.BASE_URL}${manifest.model}?v=${manifest.modelHash.slice(0, 12)}`;
export const modelSizeLabel = `${(manifest.sizes.optimizedBytes / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Mo`;
