// The points of one lap the forecast steps through (spec 6.3, S25): the braking zones (where a pass can happen), each
// DRS zone's detection and end, and the line. Sorted by lap fraction; the line closes the lap at fraction 1.
import type { DrsZone } from '@pitwall/domain';

export const POINT = { braking: 0, detection: 1, drsEnd: 2, line: 3 } as const;
export type PointKind = (typeof POINT)[keyof typeof POINT];

export type LapPoints = {
  /** Per point, in lap order: its lap fraction, its kind, and its zone (the braking zone's or the DRS zone's index). */
  fraction: Float64Array;
  kind: Uint8Array;
  zone: Int16Array;
};

/** A fraction in (0, 1): a point on the line itself belongs to the end of the lap before. */
const inLap = (x: number): number => {
  const f = ((x % 1) + 1) % 1;
  return f === 0 ? 1 - 1e-9 : f;
};

export function lapPoints(brakingZones: Float64Array, drsZones: readonly DrsZone[]): LapPoints {
  const points: { fraction: number; kind: PointKind; zone: number }[] = [];
  brakingZones.forEach((f, zone) => points.push({ fraction: inLap(f), kind: POINT.braking, zone }));
  drsZones.forEach((z, zone) => {
    points.push({ fraction: inLap(z.detection), kind: POINT.detection, zone });
    points.push({ fraction: inLap(z.end), kind: POINT.drsEnd, zone });
  });
  points.sort((a, b) => a.fraction - b.fraction || a.kind - b.kind);
  points.push({ fraction: 1, kind: POINT.line, zone: 0 });
  return {
    fraction: Float64Array.from(points, (p) => p.fraction),
    kind: Uint8Array.from(points, (p) => p.kind),
    zone: Int16Array.from(points, (p) => p.zone),
  };
}
