import { CATEGORY_META, boundsOf, type CampusBuilding, type Coordinate } from '../lib/campus';

export default function BuildingPreview({ building }: { building: CampusBuilding }) {
  const project = (point: Coordinate, height: number): Coordinate => [point[0] - point[1] * 0.7, (point[0] + point[1]) * 0.35 - height];
  const allPoints = building.polygons.flatMap((polygon) => polygon[0].flatMap((point) => [project(point, 0), project(point, building.height)]));
  const bounds = boundsOf(allPoints);
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.12;
  const roofPath = building.polygons.map((polygon) => polygon.map((ring) => ring.map((point, index) => `${index ? 'L' : 'M'}${project(point, building.height).join(',')}`).join(' ') + ' Z').join(' ')).join(' ');
  return (
    <div className="building-preview">
      <span className="preview-number">BÂTIMENT {building.number}</span>
      <svg viewBox={`${bounds.minX - margin} ${bounds.minZ - margin} ${bounds.maxX - bounds.minX + margin * 2} ${bounds.maxZ - bounds.minZ + margin * 2}`} aria-label={`Volume de ${building.name}`} role="img">
        {building.polygons.flatMap((polygon, polygonIndex) => polygon.flatMap((ring, ringIndex) => ring.slice(1).map((point, index) => {
          const start = ring[index];
          const points = [project(start, 0), project(point, 0), project(point, building.height), project(start, building.height)];
          return <polygon key={`${polygonIndex}-${ringIndex}-${index}`} points={points.map((coordinate) => coordinate.join(',')).join(' ')} fill={point[0] > start[0] ? '#c9cbb8' : '#e9e5d5'} stroke="#b3b89e" strokeWidth="0.18" />;
        })))}
        <path d={roofPath} fill={CATEGORY_META[building.category].roof} fillRule="evenodd" stroke="#fffdf3" strokeWidth="0.65" />
      </svg>
      <span className="preview-caption">Volume indicatif</span>
    </div>
  );
}
