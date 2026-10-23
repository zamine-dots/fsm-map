import { prepareCampus, type CampusData, type CampusModel } from './campus';

let geometry: Promise<CampusModel> | null = null;

export function loadCampusGeometry(): Promise<CampusModel> {
  geometry ??= fetch(`${import.meta.env.BASE_URL}data/campus.geojson`)
    .then((response) => {
      if (!response.ok) throw new Error('Le plan du campus n’a pas pu être chargé.');
      return response.json() as Promise<CampusData>;
    })
    .then(prepareCampus)
    .catch((error: unknown) => { geometry = null; throw error; });
  return geometry;
}
