import { useMemo } from 'react';
import { polygonPath } from '../lib/building-tags';
import { COUR_ROUGE, courRougePavingJoints, courRougePolygon } from '../lib/campus-landmarks';
import type { Coordinate } from '../lib/campus';

/** Shared, opaque paving for both SVG maps. The garden holes stay transparent. */
export default function CourtyardSurface({ origin }: { origin: Coordinate }) {
  const [longitude, latitude] = origin;
  const shape = useMemo(() => polygonPath(courRougePolygon([longitude, latitude])), [longitude, latitude]);
  const joints = useMemo(() => courRougePavingJoints([longitude, latitude]).map(([a, b]) => `M${a[0]},${a[1]} L${b[0]},${b[1]}`).join(' '), [longitude, latitude]);
  return <g className="campus-courtyard" data-place-kind={COUR_ROUGE.kind} role="img" aria-label={`${COUR_ROUGE.name} · ${COUR_ROUGE.typeLabel}`}>
    <path data-landmark-id={COUR_ROUGE.id} d={shape} fill={COUR_ROUGE.color} fillRule="evenodd" stroke={COUR_ROUGE.paving.edgeColor} strokeWidth=".28"><title>{COUR_ROUGE.name} · {COUR_ROUGE.typeLabel}</title></path>
    <path data-courtyard-paving="true" d={joints} fill="none" stroke={COUR_ROUGE.paving.jointColor} strokeWidth={COUR_ROUGE.paving.jointWidthMeters} pointerEvents="none" />
  </g>;
}
